'use strict';

// Checks that the partner page renders cards and that the role-definition page
// still renders its table.
//
// Both share one view container, so a card/grid change is exactly the kind that
// silently breaks the other page: the wrong class left behind turns the table into
// a grid, or the card markup appears where columns are expected.

const { app, BrowserWindow } = require('electron');

const url = process.env.LOOPFORGE_PROBE_URL || 'http://127.0.0.1:5180/';
const login = process.env.LOOPFORGE_PROBE_LOGIN || 'admin';
const password = process.env.LOOPFORGE_PROBE_PASSWORD || 'AdminTest2026!';

app.disableHardwareAcceleration();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(win, expression, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const value = await win.webContents.executeJavaScript(expression).catch(() => false);
    if (value) return value;
    await sleep(250);
  }
  return false;
}

const gotoView = (name) => `
  (async () => {
    // 点真实按钮，不直接调 switchView：直接调用会被 applyAgentRoute() 按当前 hash
    // 顶回上一个视图，测出来的就不是目标页。伙伴在 rail，角色定义在设置侧栏。
    const btn = [...document.querySelectorAll('[data-view]')]
      .filter(el => el.dataset.view === ${JSON.stringify(name)})
      .find(el => el.offsetParent !== null || el.getClientRects().length);
    if (btn) btn.click();
    else if (typeof switchView === 'function') switchView(${JSON.stringify(name)});
    await new Promise(r => setTimeout(r, 1500));
    return true;
  })()
`;

async function main() {
  const win = new BrowserWindow({
    width: 1440, height: 960, show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });

  await win.loadURL(url);
  if (!(await waitFor(win, 'document.readyState === "complete"'))) throw new Error('页面没加载完');

  const needsLogin = await win.webContents.executeJavaScript(
    '!!document.querySelector("#loginForm, form[data-login], #loginUser")',
  );
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
    if (!(await waitFor(win, '!document.querySelector("#loginForm, form[data-login]")'))) {
      throw new Error('登录没成功');
    }
  }

  // ---------- 伙伴页：应该是卡片 ----------
  await win.webContents.executeJavaScript(gotoView('partners'));
  await sleep(1500);

  const partners = await win.webContents.executeJavaScript(`
    (() => {
      const list = document.getElementById('agentList');
      const cards = list ? list.querySelectorAll('.partner-card') : [];
      const first = cards[0];
      const emoji = first ? (first.querySelector('.partner-emoji') || {}).textContent : '';
      const portrait = first ? first.querySelector('.partner-portrait') : null;
      const hue = portrait ? portrait.style.getPropertyValue('--partner-hue') : '';
      const cols = list ? getComputedStyle(list).gridTemplateColumns : '';
      // 实际布局比声明的 grid-template-columns 可信：容器只有一个子项时
      // 计算值仍是 repeat(...) 原文，只有量宽度才能确定真的是两列。
      const listW = list ? list.getBoundingClientRect().width : 0;
      const cardW = first ? first.getBoundingClientRect().width : 0;
      const sameRow = cards.length > 1
        ? Math.abs(cards[0].getBoundingClientRect().top - cards[1].getBoundingClientRect().top) < 2
        : null;
      return {
        title: (document.querySelector('#agentsView .page-heading h1') || {}).textContent,
        gridClass: list ? list.classList.contains('partner-grid') : false,
        cards: cards.length,
        emoji: (emoji || '').trim(),
        hue,
        cols,
        listW: Math.round(listW),
        cardW: Math.round(cardW),
        sameRow,
        rows: list ? list.querySelectorAll('.agent-row').length : 0,
        tabsHidden: (document.querySelector('#agentsView [data-scope-for="agent"]') || {}).hidden,
      };
    })()
  `);

  if (!partners.gridClass) throw new Error('伙伴页没有进入卡片模式');
  if (!partners.cards) throw new Error('伙伴页没有渲染出卡片');
  if (partners.rows) throw new Error('伙伴页里还残留表格行：' + partners.rows);
  if (!partners.emoji) throw new Error('卡片没有 emoji 头像');
  if (!partners.hue) throw new Error('卡片没有底色色相');
  console.log('OK 伙伴页：标题=' + JSON.stringify(partners.title) +
    ' 卡片=' + partners.cards + ' 头像=' + partners.emoji +
    ' 色相=' + partners.hue + ' 列=' + partners.cols);
  if (!partners.tabsHidden) console.log('  注意：范围标签仍显示');
  // 一行两张：卡片宽度应该接近容器的一半（单张时也能据此判定）。
  const ratio = partners.listW ? partners.cardW / partners.listW : 0;
  const twoPerRow = partners.sameRow === true || (ratio > 0.4 && ratio < 0.6);
  console.log('OK 一行两列：' + (twoPerRow ? '是' : '否') +
    '（卡片 ' + partners.cardW + 'px / 容器 ' + partners.listW + 'px）');
  if (!twoPerRow) throw new Error('卡片没有排成一行两张');

  // ---------- 角色定义页：应该还是表格 ----------
  await win.webContents.executeJavaScript(gotoView('agents'));
  await sleep(1500);

  const agents = await win.webContents.executeJavaScript(`
    (() => {
      const list = document.getElementById('agentList');
      return {
        title: (document.querySelector('#agentsView .page-heading h1') || {}).textContent,
        gridClass: list ? list.classList.contains('partner-grid') : false,
        cards: list ? list.querySelectorAll('.partner-card').length : 0,
        rows: list ? list.querySelectorAll('.agent-row').length : 0,
        display: list ? getComputedStyle(list).display : '',
        tabsHidden: (document.querySelector('#agentsView [data-scope-for="agent"]') || {}).hidden,
      };
    })()
  `);

  if (agents.gridClass) throw new Error('角色定义页被留在了卡片模式');
  if (agents.cards) throw new Error('角色定义页出现了卡片');
  if (agents.display !== 'block') throw new Error('角色定义页的表格布局被改了：display=' + agents.display);
  console.log('OK 角色定义页：标题=' + JSON.stringify(agents.title) +
    ' 表格行=' + agents.rows + ' display=' + agents.display +
    ' 范围标签隐藏=' + agents.tabsHidden);

  // ---------- 点开一张卡片 ----------
  await win.webContents.executeJavaScript(gotoView('partners'));
  await sleep(1200);
  const opened = await win.webContents.executeJavaScript(`
    (async () => {
      const card = document.querySelector('.partner-card');
      if (!card) return { error: 'no-card' };
      card.click();
      await new Promise(r => setTimeout(r, 700));
      const modal = document.getElementById('agentModal');
      return {
        modalOpen: modal ? modal.classList.contains('open') : false,
        name: (modal && modal.querySelector('[name="name"]') || {}).value || '',
      };
    })()
  `);
  if (opened.error) throw new Error(opened.error);
  if (!opened.modalOpen) throw new Error('点击卡片没有打开编辑向导');
  console.log('OK 点击卡片打开向导：' + JSON.stringify(opened.name));

  app.exit(0);
}

app.whenReady().then(main).catch((err) => {
  console.log('FAIL ' + (err && err.message ? err.message : String(err)));
  app.exit(1);
});
