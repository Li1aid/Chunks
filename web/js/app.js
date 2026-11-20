// 入口:装配四个 tab 视图、tab 切换、SW 注册、自动同步触发。

import * as translateView from './views/translate.js';
import * as libraryView from './views/library.js';
import * as reviewView from './views/review.js';
import * as settingsView from './views/settings.js';
import { isConfigured, isDemo } from './settings.js';
import { syncNow } from './sync.js';
import { getAllCards, putCards } from './db.js';
import { demoCards } from './demo-data.js';

// 演示模式第一次打开:放入示例卡片(独立的本地库,不会进你自己的卡片)
if (isDemo()) {
  try {
    if ((await getAllCards()).length === 0) await putCards(demoCards());
  } catch { /* 存储不可用时照常使用 */ }
}

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

const tabbar = document.getElementById('tabbar');

function switchTab(name) {
  [...tabButtons].forEach((btn, i) => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle('active', on);
    if (on) tabbar.style.setProperty('--tab-index', i);
  });
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
  let controlled = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  let updateBanner;

  function applyUpdate() {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 首次安装仅建立离线缓存；已有版本切换到新版时刷新页面。
    if (!controlled) { controlled = true; return; }
    if (refreshing || updateBanner) return;
    const hasInput = [...document.querySelectorAll('textarea, input')]
      .some((el) => el.type !== 'password' && el.value.trim()
        && (el.tagName === 'TEXTAREA' || el.closest('.panel:not([hidden])')));
    const reviewing = !document.getElementById('panel-review').hidden;
    if (!hasInput && !reviewing) { applyUpdate(); return; }

    updateBanner = document.createElement('div');
    updateBanner.className = 'app-update';
    updateBanner.setAttribute('role', 'status');
    const label = document.createElement('span');
    label.textContent = 'A new version is ready';
    const button = document.createElement('button');
    button.textContent = 'Update';
    button.addEventListener('click', applyUpdate);
    updateBanner.append(label, button);
    document.body.prepend(updateBanner);
  });

  const registration = navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  function checkForUpdate() {
    registration.then((reg) => reg.update()).catch(() => {});
  }
  checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) checkForUpdate();
  });
  window.addEventListener('online', checkForUpdate);
}
try {
  navigator.storage?.persist?.().catch(() => {});
} catch { /* 私密窗口等场景下不可用,无所谓 */ }

// 自动同步:启动时 + 回到前台时
if (isConfigured()) syncNow();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isConfigured()) syncNow();
});
