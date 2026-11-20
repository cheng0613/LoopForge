'use strict';

// Verifies a partner conversation really speaks as the partner.
//
// The binding is only meaningful if three things hold together, and each has
// failed independently in this codebase before:
//   1. the partner appears in the chat's @-mention reference pool (a global
//      partner lives in a different table than a project role, so a lookup that
//      only reads repo.Agents silently omits it);
//   2. creating a conversation with partnerId stores it;
//   3. the stored binding survives a read back, and cannot be swapped afterwards.

const { app, BrowserWindow } = require('electron');

const base = process.env.LOOPFORGE_PROBE_URL || 'http://127.0.0.1:8090';
const login = process.env.LOOPFORGE_PROBE_LOGIN || 'admin';
const password = process.env.LOOPFORGE_PROBE_PASSWORD || 'AdminTest2026!';
const partnerId = process.env.LOOPFORGE_PROBE_PARTNER || 'role-5r10';

app.disableHardwareAcceleration();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// app.exit only schedules the quit; the assertions below it would still run and
// print an "OK" after a failure. Exit the process instead.
function fail(msg) {
  console.log('FAIL ' + msg);
  process.exit(1);
}

async function main() {
  // Reuse the app's own session: the login page sets an httpOnly cookie that a
  // plain fetch from here cannot obtain on its own.
  const win = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  await win.loadURL(base + '/');
  for (let i = 0; i < 60; i++) {
    if (await win.webContents.executeJavaScript('document.readyState === "complete"').catch(() => false)) break;
    await sleep(250);
  }

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
    for (let i = 0; i < 40; i++) {
      if (await win.webContents.executeJavaScript('!document.querySelector("#loginForm, form[data-login]")').catch(() => false)) break;
      await sleep(250);
    }
  }

  // Everything below runs inside the page so it carries the session cookie.
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const j = async (url, opt) => {
        const r = await fetch(url, { credentials: 'same-origin', ...opt });
        const text = await r.text();
        let body = null;
        try { body = JSON.parse(text); } catch { body = text; }
        return { status: r.status, body };
      };

      const partnerId = ${JSON.stringify(partnerId)};

      // 1. The partner must be @-mentionable in chat.
      //
      // scope=all is required: a personal conversation (no projectId) filters out
      // everything project-owned, and a global partner belongs to no project, so
      // the unscoped call returns an empty list. The response is paged, so read
      // .items rather than assuming a bare array.
      const refs = await j('/api/assistant/references?scope=all&type=agent');
      const pool = Array.isArray(refs.body) ? refs.body : (refs.body?.items || []);
      const listed = pool.some((x) => x.type === 'agent' && x.id === partnerId);

      // 2. Create a conversation bound to the partner.
      const id = 'afprobe' + Date.now().toString(36);
      const created = await j('/api/assistant/sessions/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id, title: '伙伴单聊探针', projectId: '', partnerId,
          model: '', effort: '', messages: [],
        }),
      });

      // 3. Read it back.
      const read = await j('/api/assistant/sessions/' + id);
      const stored = read.body?.partnerId || '';

      // 4. Try to swap the binding on the same conversation.
      const swap = await j('/api/assistant/sessions/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id, title: '伙伴单聊探针', projectId: '', partnerId: 'role-someone-else',
          model: '', effort: '', messages: [],
        }),
      });
      const afterSwap = await j('/api/assistant/sessions/' + id);
      const stillBound = afterSwap.body?.partnerId || '';

      // 5. An unknown partner must be refused at creation.
      const bogus = await j('/api/assistant/sessions/afprobe' + Date.now().toString(36), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'afbogus' + Date.now().toString(36), title: 'x', projectId: '', partnerId: 'no-such-partner', model: '', effort: '', messages: [] }),
      });

      await j('/api/assistant/sessions/' + id, { method: 'DELETE' });

      return { listed, poolSize: pool.length, created: created.status, stored, swap: swap.status, stillBound, bogus: bogus.status };
    })()
  `);

  console.log('RESULT ' + JSON.stringify(result));

  if (!result.listed) fail('伙伴没有进入聊天的 @ 引用池（assistant/references 里找不到 ' + partnerId + '）');
  if (result.created !== 200) fail('创建绑定伙伴的会话失败：HTTP ' + result.created);
  if (result.stored !== partnerId) fail('创建后读回的 partnerId 不对：' + JSON.stringify(result.stored));
  if (result.stillBound !== partnerId) fail('会话的伙伴绑定被中途改掉了：' + JSON.stringify(result.stillBound));
  if (result.bogus < 400) fail('不存在的伙伴居然能创建会话：HTTP ' + result.bogus);

  console.log('OK 伙伴进了 @ 池，会话绑定写入并读回一致，绑定不可中途更换，未知伙伴被拒绝');
  app.exit(0);
}

app.whenReady().then(main).catch((e) => fail(e && e.message ? e.message : String(e)));
