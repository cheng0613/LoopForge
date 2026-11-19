'use strict';

// Shell logic that does not need Electron: the health probe and URL resolution.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const health = require('../src/health');
const serverConfig = require('../src/server-config');
const buildConfig = require('../src/build-config');

let failures = 0;
async function test(name, fn) {
  const saved = process.env.LOOPFORGE_DESKTOP_URL;
  delete process.env.LOOPFORGE_DESKTOP_URL;
  try {
    await fn();
    console.log('  ok   ' + name);
  } catch (err) {
    failures++;
    console.error('  FAIL ' + name + '\n       ' + err.message);
  } finally {
    if (saved === undefined) delete process.env.LOOPFORGE_DESKTOP_URL;
    else process.env.LOOPFORGE_DESKTOP_URL = saved;
  }
}

(async () => {
  console.log('health probe');

  await test('returns false for a closed port', async () => {
    assert.strictEqual(await health.check('http://127.0.0.1:1', { timeoutMs: 300 }), false);
  });

  await test('returns false for an unparsable url', async () => {
    assert.strictEqual(await health.check('not-a-url', { timeoutMs: 300 }), false);
  });

  const http = require('node:http');
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ok"}');
    } else {
      res.writeHead(404);
      res.end('nope');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  await test('returns true when /api/health answers 200', async () => {
    assert.strictEqual(await health.check(`http://127.0.0.1:${port}`), true);
  });

  server.close();

  console.log('url resolution');

  await test('a source checkout defaults to the local compose stack', async () => {
    const plan = serverConfig.resolvePlan({ isDev: true, isPackaged: false });
    assert.strictEqual(plan.baseUrl, 'http://127.0.0.1:8090');
    assert.strictEqual(plan.source, 'dev-default');
  });

  await test('the environment overrides for one run', async () => {
    process.env.LOOPFORGE_DESKTOP_URL = 'https://loopforge.example.com/';
    const plan = serverConfig.resolvePlan({ isDev: true });
    assert.strictEqual(plan.baseUrl, 'https://loopforge.example.com', 'trailing slash trimmed');
    assert.strictEqual(plan.source, 'env');
  });

  await test('a packaged build with no baked url explains the misbuild', async () => {
    // Simulate a release built without LOOPFORGE_BUILD_URL.
    const saved = buildConfig.BUILD_URL;
    assert.throws(
      () => serverConfig.resolvePlan({ isDev: false, isPackaged: true }),
      /没有绑定平台地址/
    );
    assert.strictEqual(buildConfig.BUILD_URL, saved, 'the constant is not mutated');
  });

  console.log('build url baking');

  const hook = require('./bake-build-url.js');
  const envFile = path.join(__dirname, '..', 'src', 'build-env.json');
  const buildConfigPath = path.join(__dirname, '..', 'src', 'build-config.js');

  await test('a missing LOOPFORGE_BUILD_URL is rejected', async () => {
    const saved = process.env.LOOPFORGE_BUILD_URL;
    delete process.env.LOOPFORGE_BUILD_URL;
    try {
      assert.throws(() => hook.readBuildUrl(), /LOOPFORGE_BUILD_URL is required/);
    } finally {
      if (saved !== undefined) process.env.LOOPFORGE_BUILD_URL = saved;
    }
  });

  await test('a malformed or non-http url is rejected', async () => {
    const saved = process.env.LOOPFORGE_BUILD_URL;
    try {
      for (const bad of ['not-a-url', 'ftp://host/x']) {
        process.env.LOOPFORGE_BUILD_URL = bad;
        assert.throws(() => hook.readBuildUrl(), /not a valid URL|must start with/);
      }
    } finally {
      if (saved === undefined) delete process.env.LOOPFORGE_BUILD_URL;
      else process.env.LOOPFORGE_BUILD_URL = saved;
    }
  });

  await test('beforePack writes build-env.json and afterPack removes it', async () => {
    const saved = process.env.LOOPFORGE_BUILD_URL;
    process.env.LOOPFORGE_BUILD_URL = 'https://demo.example.com/';
    try {
      hook.beforePackSync();
      assert.ok(fs.existsSync(envFile), 'build-env.json should exist after beforePack');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(envFile, 'utf8')), {
        buildUrl: 'https://demo.example.com',
      });

      hook.afterPackSync();
      assert.ok(!fs.existsSync(envFile), 'build-env.json should be gone after afterPack');
    } finally {
      hook.afterPackSync();
      if (saved === undefined) delete process.env.LOOPFORGE_BUILD_URL;
      else process.env.LOOPFORGE_BUILD_URL = saved;
    }
  });

  await test('the build never edits src/build-config.js', async () => {
    // The whole point of the generated file: a build that dies midway must not
    // leave the checkout modified.
    const saved = process.env.LOOPFORGE_BUILD_URL;
    const before = fs.readFileSync(buildConfigPath, 'utf8');
    process.env.LOOPFORGE_BUILD_URL = 'https://demo.example.com';
    try {
      hook.beforePackSync();
      assert.strictEqual(
        fs.readFileSync(buildConfigPath, 'utf8'),
        before,
        'build-config.js must be untouched while baking'
      );
    } finally {
      hook.afterPackSync();
      if (saved === undefined) delete process.env.LOOPFORGE_BUILD_URL;
      else process.env.LOOPFORGE_BUILD_URL = saved;
    }
  });

  await test('resolvePlan reports a baked url as source=build', async () => {
    // Regression: an earlier version compared against a constant that no longer
    // existed, so a baked build was reported as dev-default.
    const saved = process.env.LOOPFORGE_BUILD_URL;
    delete process.env.LOOPFORGE_BUILD_URL;
    process.env.LOOPFORGE_BUILD_URL = 'https://demo.example.com';
    try {
      hook.beforePackSync();
      delete process.env.LOOPFORGE_DESKTOP_URL;
      const plan = serverConfig.resolvePlan({ isDev: false, isPackaged: true });
      assert.strictEqual(plan.baseUrl, 'https://demo.example.com');
      assert.strictEqual(plan.source, 'build');
    } finally {
      hook.afterPackSync();
      delete process.env.LOOPFORGE_DESKTOP_URL;
      if (saved === undefined) delete process.env.LOOPFORGE_BUILD_URL;
      else process.env.LOOPFORGE_BUILD_URL = saved;
    }
  });

  console.log('the app has no configuration surface');

  await test('no setup/runner/settings modules remain', async () => {
    const dir = path.join(__dirname, '..', 'src');
    for (const gone of ['setup.html', 'setup-window.js', 'setup-preload.js', 'wsl-runner.js', 'runner-config.js', 'settings.js']) {
      assert.ok(!fs.existsSync(path.join(dir, gone)), `${gone} should have been removed`);
    }
  });

  await test('main.js wires no setup or runner lifecycle', async () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    for (const forbidden of ['setup-window', 'runner-config', 'startRunner', 'runnerProcess', 'ipcMain']) {
      assert.ok(!main.includes(forbidden), `main.js should not reference ${forbidden}`);
    }
  });

  console.log(failures === 0 ? '\nall smoke tests passed' : `\n${failures} test(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
