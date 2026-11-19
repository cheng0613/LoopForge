'use strict';

// electron-builder hooks that bake the platform address into the bundle.
//
//   LOOPFORGE_BUILD_URL=https://loopforge.example.com npm run dist
//
// The address reaches the bundle through a generated file, not by editing a
// source file:
//
//   beforePack  writes src/build-env.json (runs before app files are copied)
//   afterPack   deletes it again (runs once they are on disk)
//
// Editing src/build-config.js instead would need a restore step, and a restore
// tied to process exit is not a guarantee: electron-builder packs targets in
// parallel, and a killed build would leave the checkout modified. build-env.json
// is gitignored and is the only file these hooks touch, so a build that dies
// midway leaves an ignored file rather than a changed source file — and the
// next build overwrites it.

const fs = require('node:fs');
const path = require('node:path');

const ENV_FILE = path.join(__dirname, '..', 'src', 'build-env.json');

/** Validate LOOPFORGE_BUILD_URL and return it without a trailing slash. */
function readBuildUrl() {
  const raw = (process.env.LOOPFORGE_BUILD_URL || '').trim().replace(/\/+$/, '');
  if (!raw) {
    throw new Error(
      'LOOPFORGE_BUILD_URL is required to package the desktop app, ' +
        'e.g. LOOPFORGE_BUILD_URL=https://loopforge.example.com npm run dist'
    );
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`LOOPFORGE_BUILD_URL is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('LOOPFORGE_BUILD_URL must start with http:// or https://');
  }
  return raw;
}

/** Write the address where build-config.js will read it. */
function beforePack() {
  const url = readBuildUrl();
  fs.writeFileSync(ENV_FILE, JSON.stringify({ buildUrl: url }, null, 2) + '\n', 'utf8');
  console.log(`  • baked platform url ${url}`);
}

/** Remove the generated file so the checkout is unchanged after a build. */
function afterPack() {
  try {
    fs.rmSync(ENV_FILE, { force: true });
    console.log('  • removed src/build-env.json');
  } catch (err) {
    console.warn(`  • could not remove src/build-env.json: ${err.message}`);
  }
}

exports.beforePack = async function () {
  beforePack();
};

exports.afterPack = async function () {
  afterPack();
};

exports.readBuildUrl = readBuildUrl;
exports.beforePackSync = beforePack;
exports.afterPackSync = afterPack;
exports.ENV_FILE = ENV_FILE;
