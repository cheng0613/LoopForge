'use strict';

// End-to-end launch check for the desktop shell.
//
// Starts Electron against a real (or stubbed) platform URL, waits for the
// window to finish loading, then asserts what it rendered. Exits non-zero on
// failure so it can gate CI.
//
// Usage:
//   node scripts/launch-check.js                 # expects http://127.0.0.1:8090
//   LOOPFORGE_DESKTOP_URL=... node scripts/launch-check.js

const { spawn } = require('node:child_process');
const path = require('node:path');

const electron = require('electron');

const url = process.env.LOOPFORGE_DESKTOP_URL || 'http://127.0.0.1:8090';
const timeoutMs = Number(process.env.LOOPFORGE_LAUNCH_TIMEOUT_MS || 60000);

// The probe script runs inside Electron's main process and reports back over
// stdout, which is separate from the app's own logging.
const probe = path.join(__dirname, 'launch-probe.js');

console.log('launching electron against', url);
const child = spawn(electron, [probe, url], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, LOOPFORGE_PROBE_URL: url },
  windowsHide: true,
});

let output = '';
const timer = setTimeout(() => {
  console.error(`launch check timed out after ${timeoutMs}ms`);
  child.kill();
  process.exit(1);
}, timeoutMs);

child.stdout.on('data', (d) => {
  const s = d.toString();
  output += s;
  process.stdout.write(s);
});
child.stderr.on('data', (d) => {
  const s = d.toString();
  output += s;
  process.stderr.write(s);
});

child.on('exit', (code) => {
  clearTimeout(timer);
  if (code !== 0) {
    console.error('launch check failed (exit ' + code + ')');
    process.exit(1);
  }
  if (!output.includes('PROBE_OK')) {
    console.error('launch check: probe did not report success');
    process.exit(1);
  }
  console.log('launch check passed');
  process.exit(0);
});
