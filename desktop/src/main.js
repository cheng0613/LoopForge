'use strict';

// LoopForge desktop shell.
//
// The platform is one deployment on a server. This app is a window onto it:
// it loads the baked-in address, and everything — agents, sandboxes, data —
// stays on the server. There is nothing to configure and nothing to supervise.
//
// What the shell adds over a browser tab:
//   - its own window, icon and taskbar entry;
//   - a single instance, so a second launch focuses the first;
//   - external links open in the real browser instead of navigating the app;
//   - no address bar or extensions, so the window stays on LoopForge.

const { app, BrowserWindow, shell, dialog } = require('electron');

const serverConfig = require('./server-config');
const health = require('./health');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** The platform origin, e.g. https://loopforge.example.com */
let appBaseUrl = null;
let isQuitting = false;

// One window per user: a second launch focuses the existing one instead of
// opening a duplicate session against the same server.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function log(...args) {
  console.log('[desktop]', ...args);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1d1f23',
    show: false,
    title: 'LoopForge',
    autoHideMenuBar: true,
    webPreferences: {
      // The platform runs its own auth and sandbox rules; the shell adds no
      // preload bridge, so the window has no Node access.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Links belong in the user's browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  // A same-window navigation away from the platform also goes to the browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!appBaseUrl || !url.startsWith(appBaseUrl)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function showLoading() {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>LoopForge</title>
<style>
  html,body{height:100%;margin:0}
  body{display:grid;place-items:center;background:#1d1f23;color:#d7dae0;
       font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .box{text-align:center}
  .spin{width:28px;height:28px;margin:0 auto 16px;border-radius:50%;
        border:3px solid #3b3f45;border-top-color:#526ce8;animation:s .8s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  .hint{opacity:.6;font-size:12px;margin-top:8px}
</style></head><body><div class="box">
  <div class="spin"></div>
  <div>正在连接 LoopForge…</div>
</div></body></html>`;
  // This navigation is expected to be interrupted when the real URL loads, so
  // its rejection must not escape: an unhandled rejection prints a scary stack
  // for a normal transition.
  return mainWindow
    .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    .catch(() => {
      /* replaced by the platform URL, which is the next step */
    });
}

/** Poll /api/health until it answers, so the window does not flash an error. */
async function waitForHealth(baseUrl, timeoutMs) {
  const started = Date.now();
  for (;;) {
    if (await health.check(baseUrl)) return true;
    if (Date.now() - started >= timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function boot() {
  let plan;
  try {
    plan = serverConfig.resolvePlan({ isDev: process.env.LOOPFORGE_DESKTOP_DEV === '1' });
  } catch (err) {
    dialog.showErrorBox('无法启动 LoopForge', err.message);
    app.quit();
    return;
  }

  appBaseUrl = plan.baseUrl;
  log('platform:', appBaseUrl, '(' + plan.source + ')');

  createWindow();
  await showLoading();

  // A server on another machine can take a moment; give it a generous window
  // rather than showing Chromium's error page.
  const ok = await waitForHealth(appBaseUrl, 30000);
  if (!ok) {
    log('platform did not answer /api/health; loading anyway');
    // Loading anyway lets the user through on a slow start or a proxy that
    // hides the health endpoint.
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    await mainWindow.loadURL(appBaseUrl);
    log('loaded');
  } catch (err) {
    // A real failure (server down, TLS error) must not be silent. The window
    // stays open so the user can read the message against the real UI.
    log('failed to load platform:', err.message);
    dialog.showErrorBox(
      '无法连接 LoopForge',
      `加载 ${appBaseUrl} 失败。\n\n${err.message}\n\n请确认服务可用后重新打开应用。`
    );
  }
}

app.whenReady().then(boot);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && appBaseUrl) {
    createWindow().loadURL(appBaseUrl);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});

// Surface a renderer crash in the console instead of a silently blank window.
app.on('render-process-gone', (_event, _contents, details) => {
  log('renderer gone:', details.reason);
});

process.on('uncaughtException', (err) => {
  log('uncaught exception:', err);
});
