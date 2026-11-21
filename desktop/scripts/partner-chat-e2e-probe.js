'use strict';

// End-to-end: the chat app, opened with ?partner=, must hand the binding to the
// session it creates. The earlier probes proved the button navigates and the
// server stores partnerId when asked; this one proves the chat app itself asks.
//
// It waits for the sent message to be persisted rather than asserting on the
// model's reply: the reply needs a working model credential, the binding does not.

const { app, BrowserWindow } = require('electron');

const url = process.env.LOOPFORGE_PROBE_URL || 'http://127.0.0.1:5180/';
const login = process.env.LOOPFORGE_PROBE_LOGIN || 'admin';
const password = process.env.LOOPFORGE_PROBE_PASSWORD || 'AdminTest2026!';
const partnerId = process.env.LOOPFORGE_PROBE_PARTNER || 'role-5r10';

app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.log('FAIL ' + msg);
  process.exit(1);
}

async function main() {
  const win = new BrowserWindow({
    width: 1440, height: 950, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  // Watch the session PUT instead of re-reading the session list: the list is
  // sorted and cached client-side, so polling it races the write. The request
  // the chat app itself sends is the thing under test.
  const sessionPuts = [];
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['*://*/api/assistant/sessions/*'] },
    (details, cb) => {
      if (details.method === 'PUT' && details.uploadData) {
        const body = Buffer.concat(details.uploadData.map((d) => d.bytes)).toString();
        try { sessionPuts.push(JSON.parse(body)); } catch { /* ignore non-JSON */ }
      }
      cb({});
    },
  );
  // Land straight in the chat frame's own page with the partner parameter, which
  // is what the workbench iframe loads.
  await win.loadURL(url + 'chatbot/?projectId=&partner=' + encodeURIComponent(partnerId));
  for (let i = 0; i < 80; i++) {
    if (await win.webContents.executeJavaScript('document.readyState === "complete"').catch(() => false)) break;
    await sleep(250);
  }
  await sleep(2500);

  const needsLogin = await win.webContents.executeJavaScript(
    '!!document.querySelector("#loginForm, form[data-login], #loginUser")',
  ).catch(() => false);
  if (needsLogin) {
    await win.webContents.executeJavaScript(`
      (() => {
        const u = document.querySelector('#loginUser, input[name="username"]');
        const p = document.querySelector('#loginPass, input[name="password"]');
        if (u) { u.value = ${JSON.stringify(login)}; u.dispatchEvent(new Event('input', {bubbles:true})); }
        if (p) { p.value = ${JSON.stringify(password)}; p.dispatchEvent(new Event('input', {bubbles:true})); }
        const f = document.querySelector('#loginForm, form[data-login]');
        if (f && f.requestSubmit) f.requestSubmit();
        return true;
      })()
    `);
    await sleep(1500);
  }

  // Type into the composer and send. The exact selectors vary, so try the common
  // ones and report what was found on failure.
  const typed = await win.webContents.executeJavaScript(`
    (() => {
      const box = document.querySelector('textarea, [contenteditable="true"]');
      if (!box) return { ok: false, reason: 'composer not found' };
      box.focus();
      return { ok: true, tag: box.tagName };
    })()
  `);
  if (!typed.ok) fail('聊天输入框没找到：' + typed.reason);

  // The composer learns its send target asynchronously: the execution-machine
  // picker starts disabled ("加载执行机器…") and the send button stays disabled
  // until that settles. Typing before then silently leaves the button disabled,
  // so wait for it rather than racing the boot.
  for (let i = 0; i < 40; i++) {
    const ready = await win.webContents.executeJavaScript(`
      (() => {
        const m = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('执行机器'));
        return !!m && !m.disabled;
      })()
    `).catch(() => false);
    if (ready) break;
    await sleep(500);
  }

  // React reads textarea.value through its own tracker, so assigning .value
  // directly is swallowed. Go through the native prototype setter and fire the
  // input event React listens for.
  const typedText = await win.webContents.executeJavaScript(`
    (() => {
      const ta = document.querySelector('textarea');
      if (!ta) return { ok: false, reason: 'textarea missing' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '你好，介绍一下你自己');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, value: ta.value };
    })()
  `);
  if (!typedText.ok) fail('无法输入内容：' + typedText.reason);
  await sleep(900);

  const sent = await win.webContents.executeJavaScript(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').includes('发送'));
      if (!btn) return { ok: false, reason: 'send button not found' };
      if (btn.disabled) return { ok: false, reason: 'send button still disabled' };
      btn.click();
      return { ok: true };
    })()
  `);
  if (!sent.ok) fail('发送消息失败：' + sent.reason);

  // Wait for the session PUT the send triggers.
  let created = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    created = sessionPuts.find((p) => p && p.id && !(p.messages && p.messages.length));
    if (created) break;
  }

  console.log('RESULT ' + JSON.stringify({
    puts: sessionPuts.length,
    created: created ? { id: created.id, partnerId: created.partnerId || '' } : null,
  }));

  if (!created) fail('发送后没有创建会话（PUT /api/assistant/sessions 没发生）');
  if (created.partnerId !== partnerId) {
    fail('创建的会话没有带上伙伴绑定：partnerId=' + JSON.stringify(created.partnerId || ''));
  }
  console.log('OK 聊天端建立会话时带上了 partnerId=' + partnerId + '，会话 ' + created.id);
  app.exit(0);
}

app.whenReady().then(main).catch((e) => fail(e && e.message ? e.message : String(e)));
