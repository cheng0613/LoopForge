'use strict';

// Which URL the window loads.
//
// The platform is one deployment, so the address is baked into the package at
// build time (scripts/bake-build-url.js). There is nothing for the user to
// configure: the app opens and is connected.
//
// A developer can override for one run with LOOPFORGE_DESKTOP_URL, which is how
// the source checkout points at the local compose stack.

const buildConfig = require('./build-config');

/**
 * Resolve the URL the window should load.
 *
 * @param {{isDev?: boolean, isPackaged?: boolean}} [ctx]
 * @returns {{baseUrl: string, source: string}}
 */
function resolvePlan({ isDev = false, isPackaged = false } = {}) {
  const baseUrl = buildConfig.resolveBaseUrl({ isDev, isPackaged });

  if (!baseUrl) {
    // A packaged build only lands here if LOOPFORGE_BUILD_URL was not set when
    // it was built. Say exactly that, rather than asking the user for an
    // address they have no way to know.
    throw new Error(
      '这个安装包没有绑定平台地址。\n\n' +
        '打包时需要设置 LOOPFORGE_BUILD_URL，例如：\n\n' +
        '  LOOPFORGE_BUILD_URL=https://loopforge.example.com npm run dist'
    );
  }

  const source = process.env.LOOPFORGE_DESKTOP_URL
    ? 'env'
    : buildConfig.bakedUrl()
      ? 'build'
      : 'dev-default';

  return { baseUrl, source };
}

module.exports = { resolvePlan };
