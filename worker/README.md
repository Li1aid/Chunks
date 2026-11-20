# Cloudflare Worker 部署指南

「语块」App 的后端,提供两件事:

1. **Anthropic API 代理** — 把 key 藏在服务端,前端不再裸奔 key
2. **卡片云同步** — 用 Cloudflare D1(SQLite)存卡片,实现多设备同步

部署一次,后续多设备共用一个 Worker URL + 口令 即可。

---

## 一次性部署步骤

### 1. 注册 Cloudflare

https://dash.cloudflare.com/sign-up 注册并验证邮箱。注册时让你「添加域名」直接跳过,我们用 Cloudflare 默认给的子域。

### 2. 创建 D1 数据库

1. 登录后,左侧菜单 **Workers & Pages** → **D1**
2. 点 **Create database**,名字随便,例如 `yuyukai-db`,点 **Create**
3. 进入数据库,顶部点 **Console**(SQL 控制台)
4. 把仓库里 [`schema.sql`](./schema.sql) 的全部内容粘贴进去,点 **Execute**
   - 应该看到 "Created 1 table, 1 index"
5. 离开页面前**记住数据库名**(下一步要绑定)

### 3. 创建 Worker

1. 左侧 **Workers & Pages** → **Create application** → **Create Worker**
2. 名字例如 `yuyukai-proxy`,点 **Deploy**
3. 部署完成后点 **Edit code**
4. 把 [`worker.js`](./worker.js) 的全部内容复制进去,替换默认代码
5. 右上角 **Save and deploy**

### 4. 给 Worker 绑定 D1 数据库(关键!)

1. 回 Worker 详情页,顶部 **Settings**
2. 找到 **Bindings**(老界面在左边的 **Variables**)
3. 点 **Add binding** → **D1 Database**:
   - **Variable name**: `DB`(必须叫这个,代码里写死了)
   - **D1 database**: 选你刚才建的 `yuyukai-db`
4. 保存,然后必须再 **Deploy** 一次让绑定生效

### 5. 配置环境变量

同样在 **Settings → Variables and Secrets**,添加两条 **Secret**(Type 选 Secret 不选 Plaintext):

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | 你的真实 Anthropic key,以 `sk-ant-` 开头 |
| `ALLOWED_TOKEN` | 自己起一段长口令,例如 `openssl rand -hex 32` 生成的 64 位 hex |

加完再 **Deploy** 一次。

### 6. 拿到 Worker URL

在 Worker 详情页顶部能看到形如 `https://yuyukai-proxy.<你的子域>.workers.dev` 的 URL。**记下它和 ALLOWED_TOKEN**。

### 7. 在 App 里填写

打开「语块」→ 设置 →「Worker」分组:

- **Worker 地址**:刚才那个 URL(不要带末尾 `/`)
- **ALLOWED_TOKEN**:你设置的那个口令
- 点保存,App 会自动试同步一次

成功的话,设置页底部「云同步」分组应该显示「上次同步:刚刚」。

---

## 多设备使用

在第二台设备上(另一台手机 / 电脑)打开同一个 PWA URL,然后:

1. 设置 → Worker:**填同样的 URL 和口令**
2. 保存即自动从云端拉所有卡片下来

之后两台设备各自的操作(新增/复习/删除)会通过 `updatedAt` Last-Write-Wins 自动合并。

---

## 测试是否通

终端运行(替换 URL 和 TOKEN):

```sh
# 测试翻译代理
curl -X POST 'https://你的.workers.dev/v1/messages' \
  -H 'x-app-token: 你的 ALLOWED_TOKEN' \
  -H 'content-type: application/json' \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "say hi in 3 words"}]
  }'

# 测试同步拉取(应该返回 {"cards":[],"serverTime":...})
curl 'https://你的.workers.dev/sync/cards?since=0' \
  -H 'x-app-token: 你的 ALLOWED_TOKEN'
```

排错:

| 现象 | 原因 |
|---|---|
| 401 Unauthorized | `x-app-token` 没对上 `ALLOWED_TOKEN` |
| 500 Worker 未配置 ANTHROPIC_API_KEY | Secret 没配 |
| 500 Worker 未绑定 D1 数据库 | Bindings 那一步没做或 Variable name 不是 `DB` |
| 翻译 200 但同步 500 | 数据库表没建,回到第 2 步执行 schema.sql |

---

## Cloudflare 免费额度(个人用绰绰有余)

- **Workers**:每天 100,000 次请求
- **D1**:每天 5M 次行读、100k 次行写、5GB 存储
- 你日常翻译 + 同步几辈子都用不完

---

## 数据安全

- 数据库里只有你的卡片,没有 API key
- API key 只在 Worker 的 Secret 里,任何人都看不到(包括 Cloudflare 控制台显示也是星号)
- 任何人不知道 `ALLOWED_TOKEN` 都进不来
- 万一口令泄露,改 Cloudflare 的 `ALLOWED_TOKEN` 然后所有设备 App 里更新一下即可

---

## 数据库管理小技巧

进 D1 控制台的 **Console** 页可以直接跑 SQL,例如:

```sql
-- 看现有卡片数(包含已删除)
SELECT COUNT(*) FROM cards;

-- 看场景分布
SELECT scene, COUNT(*) FROM cards WHERE deleted = 0 GROUP BY scene ORDER BY COUNT(*) DESC;

-- 永久清理软删除的卡(可选,看心情清)
DELETE FROM cards WHERE deleted = 1;
```
