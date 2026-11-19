'use strict';

// Where this build talks to.
//
// The platform is a single deployment, so its address is a build-time decision,
// not a question for the user.
//
// Resolution order:
//
//   1. LOOPFORGE_DESKTOP_URL — override for one run, and what a developer uses.
//   2. build-env.json next to this file — written by scripts/bake-build-url.js
//      into a generated copy of the tree at package time. Absent in a source
//      checkout and in the repository, so nothing has to be restored after a
//      build.
//   3. http://127.0.0.1:8090 — the compose stack from ./start.sh, for a source
//      checkout.
//
// The address is read from a generated file rather than written into this
// source file because mutating source during a build needs a restore step, and
// a restore that depends on process exit is not reliable in a parallel packer.

const fs = require('node:fs');
const path = require('node:path');

const DEV_DEFAULT = 'http://127.0.0.1:8090';
const BUILD_ENV_FILE = 'build-env.json';

function trim(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

/** The baked address, or '' when this tree was not packaged with one. */
function bakedUrl() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, BUILD_ENV_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return trim(parsed && parsed.buildUrl);
  } catch {
    return '';
  }
}

function isPackagedNow() {
  // Electron sets app.isPackaged; fall back to the asar marker so this module
  // stays usable from a plain Node script.
  try {
    return require('electron').app.isPackaged;
  } catch {
    return __dirname.includes('app.asar');
  }
}

/**
 * The platform origin this build should use.
 *
 * @param {{isDev?: boolean, isPackaged?: boolean}} [opts]
 * @returns {string} an http(s) URL, or '' when a packaged build has no default
 */
function resolveBaseUrl({ isDev = false, isPackaged } = {}) {
  const fromEnv = trim(process.env.LOOPFORGE_DESKTOP_URL);
  if (fromEnv) return fromEnv;

  const baked = bakedUrl();
  if (baked) return baked;

  // Source checkout: the compose stack on the developer's machine. A packaged
  // build gets nothing here, so resolvePlan() can report the misbuild.
  const packaged = typeof isPackaged === 'boolean' ? isPackaged : isPackagedNow();
  if (isDev || !packaged) return DEV_DEFAULT;

  return '';
}

module.exports = { resolveBaseUrl, bakedUrl, DEV_DEFAULT, BUILD_ENV_FILE };
