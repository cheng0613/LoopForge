'use strict';

// Runs inside Electron. Loads the platform URL in a real BrowserWindow and
// reports what rendered, so launch-check.js can assert on it.

const { app, BrowserWindow } = require('electron');

const url = process.env.LOOPFORGE_PROBE_URL;

app.disableHardwareAcceleration(); // headless CI has no GPU

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });

  try {
    await win.loadURL(url);

    // Give the SPA a moment to paint its first view.
    await new Promise((r) => setTimeout(r, 2500));

    const info = await win.webContents.executeJavaScript(
      `(() => ({
         title: document.title,
         hasRoot: !!document.querySelector('#bootLoader, #app, #root, body > div'),
         bodyLength: document.body ? document.body.innerText.length : 0,
         bodyText: (document.body ? document.body.innerText : '').slice(0, 120),
         url: location.href
       }))()`
    );

    console.log('PROBE_TITLE=' + info.title);
    console.log('PROBE_URL=' + info.url);
    console.log('PROBE_BODYLEN=' + info.bodyLength);
    console.log('PROBE_HASROOT=' + info.hasRoot);
    console.log('PROBE_TEXT=' + JSON.stringify(info.bodyText));

    if (!info.title && info.bodyLength === 0) {
      console.error('PROBE_FAIL: window rendered nothing');
      app.exit(1);
      return;
    }
    console.log('PROBE_OK');
    app.exit(0);
  } catch (err) {
    console.error('PROBE_FAIL: ' + err.message);
    app.exit(1);
  }
});
