# Chunks Web PWA — 设计文档

- 日期:2026-09-05
- 状态:设计已口头确认,待实现
- 路径:`web/`(本 repo 内),部署到 Cloudflare Pages

## 1. 背景与目标

Chunks 目前有两个客户端:本 repo 的原生 iOS 版(SwiftUI + SwiftData,功能最全)和一个更老的 PWA(`~/Desktop/Projects/yuyukai/`,SM-2 算法,日常在用)。目标是做一个**功能全量对齐 iOS 版的新 Web PWA**,手机浏览器打开即用、可加到主屏幕,作为老 PWA 的替代品。

约束:

- **只给 Aiden 自己用**:无账号体系,配置方式与 iOS 相同(填 Worker 地址 + 口令)。
- **后端零改动**:复用现有 Cloudflare Worker 的三个端点,与 iOS / 老 PWA 共享同一套 D1 卡片数据。
- **零构建**:原生 JS + ES modules,无 npm 依赖、无打包步骤,`web/` 目录本身就是部署产物。理由:个人项目最大的维护成本是工具链腐烂,零构建的产物永远能跑。
- 模块化隔离:每个 tab 一个 view 模块,服务模块(db/sync/ai/fsrs/speech/settings)各管一摊,view 之间不互相 import。

## 2. 已验证的事实(2026-09-05)

- Worker URL:`https://flashcards.aidenyang5995.workers.dev`(源码在 `~/Desktop/Projects/yuyukai/worker/worker.js`)。
- **CORS 已通**:线上预检返回 `access-control-allow-origin: *`,放行头 `content-type, x-app-token, anthropic-version`,方法 `GET, POST, OPTIONS`。新 PWA 部署在任意域名均可直接调用。
- Worker 端点:`GET/POST /sync/cards`(同步)、`POST /v1/messages`(Anthropic 代理)、`POST /v1/chat/completions`(DeepSeek 代理),认证统一用 `x-app-token` 头。
- D1 中仍有 `scene` 列(历史遗留),iOS 不读不写,web 版同样不读不写。

## 3. 文件结构

```
web/
  index.html            单页外壳:四个 tab 面板 + 底部 tab bar
  manifest.webmanifest  PWA 清单(name/icons/display: standalone/theme_color)
  sw.js                 Service Worker:静态资源 cache-first,API 永远走网络
  css/app.css           全局样式,prefers-color-scheme 深浅色
  icons/                PWA 图标(512/192/180 apple-touch)
  js/
    app.js              入口:tab 切换、模块装配、启动/回前台自动同步
    db.js               IndexedDB 封装(open/getAll/put/bulkPut)
    settings.js         localStorage 配置读写(见 §4)
    sync.js             同步协议(见 §5)
    ai.js               翻译调用 + 两条 system prompt(自 AIService.swift 原文复制)
    fsrs.js             FSRS-4.5 算法(自 FSRSScheduler.swift 逐行移植)
    speech.js           SpeechSynthesis 朗读(见 §10)
    views/
      translate.js      翻译 tab
      library.js        卡片库 tab
      review.js         复习 tab
      settings.js       设置 tab
tests/                  node --test 单测(不进部署目录)
  fsrs.test.js
  sync-merge.test.js
  normalize.test.js
```

view 模块统一导出 `{ mount(el), show() }`;`show()` 在每次切到该 tab 时刷新数据重渲染。状态管理不引入任何框架:数据变更 → 重渲染当前视图。

## 4. 数据层

### IndexedDB

库名 `chunks`,store `cards`,主键 `id`。字段与同步协议完全一致(18 个业务字段):

`id, en, zh, example, usage, sourceZh, sourceEn, createdAt, ease, interval, reps, due, lastReview, deleted(boolean), updatedAt, stability, difficulty, state, lapses`

- 时间戳全部为毫秒 epoch(Double 语义,JS number)。
- `id` 生成规则与 iOS 相同:`${Date.now()}-${6 位 [a-z0-9] 随机}`。
- 新卡默认值:`ease 2.5, interval 0, reps 0, due=now, lastReview 0, deleted false, stability 0, difficulty 0, state 0, lapses 0, createdAt=updatedAt=now`。
- 所有列表/队列查询先过滤 `deleted !== true`。

### localStorage 配置键

| 键 | 说明 |
|---|---|
| `workerURL` | 末尾斜杠去除后保存 |
| `appToken` | 口令,明文存(web 无 Keychain;个人自用 + HTTPS,接受此取舍) |
| `aiProvider` | `anthropic` / `deepseek`,默认:`navigator.language` 以 `zh-CN` 或 `zh-Hans` 开头 → deepseek,否则 anthropic(对齐 iOS 的 region==CN 规则) |
| `aiModel_anthropic` | 默认 `claude-sonnet-4-6`;可选 opus-4-7、haiku-4-5-20251001 |
| `aiModel_deepseek` | 默认 `deepseek-chat`;可选 deepseek-reasoner |
| `reviewDirection` | `zhToEn`(默认)/ `enToZh` |
| `lastPullServerTime` | pull 游标(服务端时间) |
| `lastPushAt` | push 游标(本地时间),与 pull 游标独立以避免时钟偏差 |
| `lastSyncAt` | 上次成功同步时间(展示用) |

## 5. 同步协议(与 CloudSyncService.swift 逐条对齐)

1. 记录 `pushStartedAt = now`。
2. **Pull**:`GET {workerURL}/sync/cards?since={lastPullServerTime 取整}`,头 `x-app-token` → `{ cards, serverTime }`。
3. **Merge**(LWW):远端卡按 `id` 对齐本地;`remote.updatedAt > local.updatedAt` → 远端覆盖本地(含 deleted);本地不存在 → 插入。合并后 `lastPullServerTime = serverTime`。
4. **Push**:本地所有 `updatedAt > lastPushAt` 的卡(含已删除),500 张一批 `POST /sync/cards`,body `{ cards: [...] }`。全部成功后 `lastPushAt = pushStartedAt`,记录 `lastSyncAt`。
5. 软删除:`deleted = true` + `updatedAt = now`,交给下次 push。

触发时机:页面加载完成(已配置时)、`visibilitychange` 回到可见、任何写操作后 1.5 秒防抖、设置页手动按钮。同步中禁止重入。

状态展示(设置页):`未配置` / `同步中…` / `上次同步:刚刚|N 分钟前|N 小时前|N 天前` / 错误文案。错误映射:401 → `口令错误,请检查`;其他非 200 → `服务端错误`;网络异常 → `网络连接失败`。

重置同步(危险操作,需确认):清空本地 cards + 两个游标 → 立即全量 pull。

## 6. 翻译 tab

- 方向自动检测:输入含任一 CJK 字符(U+4E00–9FFF、U+3400–4DBF)→ 中译英,否则英译中。
- 两条 system prompt 从 `AIService.swift` **原文复制**(含词块原形化规则)。user 消息前缀:`中文: ` / `English: `。
- Anthropic:`POST /v1/messages`,头加 `anthropic-version: 2023-06-01`,body `{model, max_tokens: 1500, system, messages:[{role:"user",...}]}`,响应取 `content[].type=="text"` 拼接。
- DeepSeek:`POST /v1/chat/completions`,body `{model, max_tokens: 2000, messages:[system,user], response_format:{type:"json_object"}}`,取 `choices[0].message.content`。
- JSON 解析三层容错:剥 ``` 围栏 → 直接 parse → 正则抠 `{...}` 再 parse,失败报 `AI 返回格式异常,请重试`。
- **自动保存**(无保存按钮):
  - 去重键 `normalizeEn`:小写 → 折叠连续空白 → 去首尾标点 `.,;:!?"'`()[]{}`(保留中间撇号/连字符)。
  - 有语块:逐个建卡(`en/zh/example` 取语块,`sourceZh/sourceEn` 取整句),与现有库及本批次内去重,重复跳过。
  - 无语块:兜底存整句卡(en=整句英文,zh=整句中文),同样查重。
  - 保存后横幅:`已保存 N 张` / `语块已存在` / `已保存 N 张,语块已存在`。
- 结果卡带朗读按钮(仅中译英方向);错误横幅带重试按钮。

## 7. 复习 tab(FSRS)

### 算法移植

`fsrs.js` 从 `FSRSScheduler.swift` 逐行移植:19 个 FSRS-4.5 默认参数 W、`desiredRetention 0.9`、`factor 19/81`、`decay -0.5`、首次评分初始化(stability=W[grade-1]、difficulty=D₀ 公式)、后续评分(retrievability → difficulty 均值回归 → 成功 α 增长 / 失败 min(S_f, S))、间隔公式与钳位([1, 36500] 天)、`currentRetrievability`(旧卡用 stability+lastReview,新卡用虚拟 stability W[2]+createdAt)。

SM-2 → FSRS bootstrap(与 iOS 相同):首次评分时若 `state==0 && stability==0 && reps>0`,用 `stability = max(1, interval/天)`、`difficulty = clamp(11 − 4×(ease−1.3), 1, 10)`、`state=1` 初始化。

评分回写(全部字段):FSRS 五项 + `due/lastReview/updatedAt`,并回写旧字段 `interval = intervalDays×86400000`、`reps = forgot ? 0 : reps+1`(保证老 PWA 仍能正常显示)。

### 队列与统计

- 今日队列:全部未删卡算 R,取 `R < 0.9` 按 R 升序,截前 **30** 张;卡库不足 **10** 张时不开放复习。
- 统计三格:待复习 = R<0.9 总数(不截断)、已熟练 = `state==1 && stability≥30`、总数。
- 复习完队列显示"今天的复习搞定了"。

### 交互

- 复习方向可切(右上角):中→英(默认,正面中文)/ 英→中(正面英文),存 `reviewDirection`。
- 轻点翻牌(CSS 3D 翻转);Pointer Events 拖拽,横向位移主导才响应,**阈值 120px**;左滑=forgot(任何状态),右滑=翻牌后 good / 翻牌前 easy。
- 滑动时屏幕左右缘出现红/绿光晕(CSS radial-gradient,强度随 `dx/120` 钳位 ±1),达阈值松手卡片飞出。
- 卡背面:答案大字 + 对面小字 + 例句(「」引用斜体)+ 来源(`sourceZh` 非空且 ≠ zh 时显示)+ 朗读按钮(读 en)。

## 8. 卡片库 tab

- 按 `createdAt` 倒序;顶部搜索框,小写 contains 匹配 `en/zh/example`。
- 行:en(主)、zh(次)、`复习 N 次`、到期文案。到期规则:`reps≥5 && interval>30天` → `已熟练`(绿);`due≤now` → `今日待复习`(红);`<2 天` 橙,其余灰,`N 天后 / N 个月后`。
- 删除:每行删除按钮 + confirm(网页版不做列表滑动手势),走软删除 + 防抖同步。
- 空态:`还没有卡片` / `没有匹配的卡片`。

## 9. 设置 tab

与 iOS 各节对齐:

- **服务器**:Worker 地址(占位符显示已存值)、口令(password 框,占位符显示 `已保存 ····后4位`)、保存按钮(去空白、去尾斜杠;保存后触发同步)。
- **AI**:引擎选择(Claude/DeepSeek)+ 当前引擎的模型选择(两个引擎的选择各自记忆)。
- **云同步**:状态行、立即同步、重置同步(confirm)。
- **复习**:方向选择。
- **语音**:当前 voice 名称 + 刷新按钮;附提示文案:在 iOS 系统设置下载"增强/高级"英文语音后,Safari 的可用语音同样会变好。
- **数据**:总卡片数。

## 10. 朗读(speech.js)

- `speechSynthesis` 实现;`voiceschanged` 事件后初始化(iOS Safari 的 voices 列表异步加载)。
- 选 voice 启发式(对齐 iOS 的 Premium > Enhanced > Default 意图):优先 name 含 `Premium`/`Enhanced` 的英文 voice,再按 `en-US > en-GB > 其他 en` 排序,兜底任一 `en` voice。
- 语速 0.9;重复调用先 `cancel()` 再 `speak()`。
- **与 iOS 的已知差异(接受)**:web 无法绕过 iOS 静音键(iOS 版用 AVAudioSession playback 可以);无法枚举 voice 质量枚举值,只能靠名称启发式。

## 11. PWA

- `manifest.webmanifest`:`display: standalone`,主屏幕启动无浏览器边框。
- `sw.js`:安装时预缓存全部静态文件(带版本号的 cache 名,如 `chunks-v1`),fetch 对同源静态资源 cache-first,对 Worker 域名请求不拦截;新版本 activate 时清旧 cache。发版 = 改版本号。
- 离线行为:复习、卡片库、设置完全可用(IndexedDB 本地数据);翻译与同步断网时报 `网络连接失败`。
- 启动时尝试 `navigator.storage.persist()` 降低 iOS 清存储概率;即使被清,所有数据都在 D1,重填配置即可全量恢复——本地存储始终只是缓存。

## 12. 测试

- `tests/fsrs.test.js`:首评四档、后续评分成功/失败、bootstrap、retrievability、间隔钳位——若干组输入输出与 Swift 实现对算(人工核对公式推导的期望值)。
- `tests/sync-merge.test.js`:LWW 覆盖/保留/插入、软删除传播、游标推进(mock fetch)。
- `tests/normalize.test.js`:去重规范化边界(标点、多空格、大小写、中间撇号保留)。
- 运行:`node --test tests/`,零依赖。
- 手动 E2E 清单:本地静态服务器连真实 Worker → 翻译建卡 → iOS 端确认卡片同步到达 → 网页复习后 iOS 端确认 FSRS 字段变化 → 手机 Safari 加主屏幕走一遍全流程。

## 13. 部署

- Cloudflare Pages,项目名建议 `chunks-web`(URL 形如 `chunks-web.pages.dev`)。
- 命令:`npx wrangler pages deploy web --project-name chunks-web`。
- 一次性前置:Aiden 跑 `wrangler login`(浏览器授权);此后部署由 Claude 执行。

## 14. 明确不做

- 账号体系 / 多用户隔离、scene 场景功能(iOS 已删)、CRDT(单人多端 LWW 足够)、任何前端框架与构建工具、推送通知。
- 老 PWA(yuyukai)在新版稳定后建议退役:它推送时不带 FSRS 字段,可能把新字段覆盖为空(该风险 iOS 现状下同样存在,非本项目新增)。
