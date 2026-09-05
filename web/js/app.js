// 入口:装配四个 tab 视图、tab 切换、SW 注册、自动同步触发。

import * as translateView from './views/translate.js';
import * as libraryView from './views/library.js';
import * as reviewView from './views/review.js';
import * as settingsView from './views/settings.js';
import { isConfigured } from './settings.js';
import { syncNow } from './sync.js';

const views = {
  translate: translateView,
  library: libraryView,
  review: reviewView,
  settings: settingsView,
};

for (const [name, view] of Object.entries(views)) {
  view.mount(document.getElementById(`panel-${name}`));
}

const tabButtons = document.querySelectorAll('#tabbar .tab');

function switchTab(name) {
  for (const btn of tabButtons) btn.classList.toggle('active', btn.dataset.tab === name);
  for (const key of Object.keys(views)) {
    document.getElementById(`panel-${key}`).hidden = key !== name;
  }
  views[name].show();
}

for (const btn of tabButtons) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
}

views.translate.show();

// PWA:静态资源缓存 + 尽力申请持久存储(数据真正的家在 D1,本地只是缓存)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
try {
  navigator.storage?.persist?.().catch(() => {});
} catch { /* 私密窗口等场景下不可用,无所谓 */ }

// 自动同步:启动时 + 回到前台时
if (isConfigured()) syncNow();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isConfigured()) syncNow();
});
