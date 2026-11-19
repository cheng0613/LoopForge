'use strict';

// Authenticated launch check: logs in, then asserts the workbench rendered.
//
//   LOOPFORGE_PROBE_LOGIN=demo LOOPFORGE_PROBE_PASSWORD=secret npm run check:auth

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const child = spawn(electron, [path.join(__dirname, 'auth-probe.js')], {
  stdio: 'inherit',
  env: { ...process.env },
  windowsHide: true,
});

const timeoutMs = Number(process.env.LOOPFORGE_LAUNCH_TIMEOUT_MS || 90000);
const timer = setTimeout(() => {
  console.error('auth check timed out');
  child.kill();
  process.exit(1);
}, timeoutMs);

child.on('exit', (code) => {
  clearTimeout(timer);
  process.exit(code ?? 0);
});
