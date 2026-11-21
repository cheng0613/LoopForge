'use strict';

// Verifies the workbench side of "chat with this partner":
// the partner card has a chat button, clicking it lands on the chat view with the
// partner in the URL, and the chat frame is actually reloaded with that parameter
// (a reused frame would keep the previous conversation open).

const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const url = process.env.LOOPFORGE_PROBE_URL || 'http://127.0.0.1:5180/';
const login = process.env.LOOPFORGE_PROBE_LOGIN || 'admin';
const password = process.env.LOOPFORGE_PROBE_PASSWORD || 'AdminTest2026!';

app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.log('FAIL ' + msg);
  process.exit(1);
}

async function main() {
  const win = new BrowserWindow({
    width: 1440, height: 950, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  await win.loadURL(url);
  for (let i = 0; i < 60; i++) {
    if (await win.webContents.executeJavaScript('document.readyState === "complete"').catch(() => false)) break;
    await sleep(250);
  }
  await sleep(1200);

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
    for (let i = 0; i < 60; i++) {
      if (await win.webContents.executeJavaScript('!document.querySelector("#loginForm, form[data-login]")').catch(() => false)) break;
      await sleep(250);
    }
    await sleep(800);
  }

  // Go to the partners page via its real rail button.
  await win.webContents.executeJavaScript(`
    (() => {
      const b = [...document.querySelectorAll('[data-view="partners"]')].find((el) => el.getClientRects().length);
      if (b) b.click();
      return !!b;
    })()
  `);
  await sleep(1800);

  const card = await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.querySelector('.partner-card [data-partner-chat]');
      const card = document.querySelector('.partner-card');
      return {
        hasCard: !!card,
        hasChatBtn: !!btn,
        partnerId: btn ? btn.dataset.partnerChat : '',
        // The chat button must not be the more-menu, or the click opens the editor.
        isSeparate: !!btn && !btn.hasAttribute('data-agent-more'),
      };
    })()
  `);
  if (!card.hasCard) fail('伙伴页没有卡片');
  if (!card.hasChatBtn) fail('伙伴卡片上没有聊天按钮');
  if (!card.isSeparate) fail('聊天按钮和更多菜单是同一个元素');

  // Click it and watch where the app goes.
  await win.webContents.executeJavaScript(
    `document.querySelector('.partner-card [data-partner-chat]').click()`,
  );
  await sleep(2200);

  const after = await win.webContents.executeJavaScript(`
    (() => {
      const frame = document.getElementById('chatNextFrame');
      return {
        hash: location.hash,
        partnerParam: new URL(location.href).searchParams.get('partner') || '',
        view: typeof state !== 'undefined' ? state.currentView : '',
        frameSrc: frame ? frame.src : '',
        modalOpen: !!document.querySelector('#agentModal.open'),
      };
    })()
  `);

  const result = { ...card, ...after };
  console.log('RESULT ' + JSON.stringify(result));
  const shot = await win.webContents.capturePage();
  fs.writeFileSync('C:/tmp/partner-chat-shot.png', shot.toPNG());

  if (after.modalOpen) fail('点聊天按钮却打开了编辑向导（事件冒泡没挡住）');
  if (after.hash !== '#/collaboration') fail('没有跳到协作页，hash=' + after.hash);
  if (after.partnerParam !== card.partnerId) fail('URL 没带上伙伴参数：' + JSON.stringify(after.partnerParam));
  if (!after.frameSrc.includes('partner=' + encodeURIComponent(card.partnerId))) {
    fail('聊天 iframe 没有带上伙伴参数：' + after.frameSrc);
  }

  console.log('OK 卡片有聊天按钮，点击进入协作页，URL 与 iframe 都带上了伙伴 ' + card.partnerId);
  app.exit(0);
}

app.whenReady().then(main).catch((e) => fail(e && e.message ? e.message : String(e)));
