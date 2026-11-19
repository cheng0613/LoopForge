'use strict';

// Development launcher.
//
// Sets LOOPFORGE_DESKTOP_DEV=1 portably (Windows has no inline `VAR=value cmd`
// syntax) and starts Electron. Kept dependency-free on purpose so `npm run dev`
// works straight after `npm install`.
//
// In dev mode the shell attaches to an already-running platform — the compose
// stack from ./start.sh — instead of spawning its own binary.

const { spawn } = require('node:child_process');
const electron = require('electron');

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, LOOPFORGE_DESKTOP_DEV: '1' },
  windowsHide: false,
});

child.on('exit', (code) => process.exit(code ?? 0));
