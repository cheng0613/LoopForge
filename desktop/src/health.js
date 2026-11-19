'use strict';

// Health probe for the platform server.
//
// The desktop shell only considers the server usable once /api/health answers
// with a 2xx. Everything else — refused connections while the process boots,
// 404s from a proxy that is not ready, slow first-boot migrations — is treated
// as "not ready yet" rather than an error, so the caller can keep polling.

const http = require('node:http');
const https = require('node:https');

const HEALTH_PATH = '/api/health';

/**
 * @param {string} baseUrl e.g. http://127.0.0.1:8090
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<boolean>} true when the endpoint answered 2xx
 */
function check(baseUrl, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(HEALTH_PATH, baseUrl);
    } catch {
      resolve(false);
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        timeout: timeoutMs,
        headers: { accept: 'application/json' },
        // The platform is reached on loopback in local mode; do not let a
        // corporate proxy intercept the probe.
        agent: false,
      },
      (res) => {
        // Drain so the socket can be reused/closed cleanly.
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

module.exports = { check, HEALTH_PATH };
