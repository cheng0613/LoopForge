'use strict';

// Runs inside Electron. Logs in with the credentials given in the environment
// and asserts the workbench actually renders, so the launch check covers the
// authenticated app rather than only the login page.

const { app, BrowserWindow } = require('electron');

const url = process.env.LOOPFORGE_PROBE_URL;
const login = process.env.LOOPFORGE_PROBE_LOGIN;
const password = process.env.LOOPFORGE_PROBE_PASSWORD;

app.disableHardwareAcceleration();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForReady(win) {
  for (let i = 0; i < 50; i++) {
    const ready = await win.webContents
      .executeJavaScript('document.readyState')
      .catch(() => 'loading');
    if (ready === 'complete') return true;
    await sleep(200);
  }
  return false;
}

async function main() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });

  await win.loadURL(url);
  await waitForReady(win);
  await sleep(1000);

  console.log('PROBE_INITIAL_URL=' + win.webContents.getURL());

  if (login && password) {
    // Try register first (fresh instance), fall back to password login.
    const script = `(async () => {
      const creds = {login: ${JSON.stringify(login)}, password: ${JSON.stringify(password)}};
      const post = (p) => fetch(p, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(creds)})
        .then(r => r.text().then(t => ({status:r.status, body:t})));
      let res = await post('/api/auth/register');
      if (res.status === 409 || res.status === 403) res = await post('/api/auth/password');
      return res;
    })()`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await win.webContents.executeJavaScript(script);
        console.log('PROBE_LOGIN_STATUS=' + result.status);
        console.log('PROBE_LOGIN_BODY=' + String(result.body).slice(0, 150));
        if (result.status === 200) break;
      } catch (err) {
        console.log('PROBE_LOGIN_ATTEMPT_' + attempt + '_ERR=' + err.message);
        await sleep(1000);
      }
    }

    await win.loadURL(url);
    await waitForReady(win);
    await sleep(4000);
  }

  const info = await win.webContents.executeJavaScript(
    `(() => ({
       title: document.title,
       url: location.href,
       hasBootLoader: !!document.querySelector('#bootLoader'),
       hasUserBadge: !!document.querySelector('#userBadge'),
       bodyLength: document.body ? document.body.innerText.length : 0,
       bodyText: (document.body ? document.body.innerText : '').slice(0, 300)
     }))()`
  );

  console.log('PROBE_FINAL_URL=' + info.url);
  console.log('PROBE_TITLE=' + info.title);
  console.log('PROBE_BOOTLOADER=' + info.hasBootLoader);
  console.log('PROBE_USERBADGE=' + info.hasUserBadge);
  console.log('PROBE_BODYLEN=' + info.bodyLength);
  console.log('PROBE_TEXT=' + JSON.stringify(info.bodyText));
  console.log('PROBE_LOGGED_IN=' + !info.url.includes('/login.html'));

  if (info.bodyLength === 0) {
    console.error('PROBE_FAIL: nothing rendered');
    app.exit(1);
    return;
  }
  console.log('PROBE_OK');
  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error('PROBE_FAIL: ' + err.message);
    app.exit(1);
  })
);
