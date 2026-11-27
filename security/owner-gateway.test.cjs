'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOwnerGateway } = require('./owner-gateway.cjs');

const OWNER_TOKEN = 'this-is-a-unique-strong-owner-token-for-Nexus-2026';

function gateway(env = {}) {
  return createOwnerGateway({ env: { NODE_ENV: 'development', ...env }, port: 3000 });
}

function request({
  path = '/', method = 'GET', host = 'localhost:3000',
  origin, cookie, remoteAddress = '127.0.0.1',
  fetchSite = 'same-origin', contentType, body = '',
} = {}) {
  const headers = { host, 'sec-fetch-site': fetchSite };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (contentType) headers['content-type'] = contentType;
  return {
    url: path, method, headers, socket: { remoteAddress },
    async *[Symbol.asyncIterator]() { if (body) yield { toString: () => body }; },
  };
}

function response() {
  return {
    status: 0, headers: {}, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body || ''; },
  };
}

async function hit(g, opts) {
  const req = request(opts), res = response();
  const passed = await g.guardHttp(req, res);
  return { passed, ...res };
}

async function login(g, { origin = 'http://localhost:3000', host = 'localhost:3000', token = OWNER_TOKEN } = {}) {
  const result = await hit(g, {
    path: '/access', method: 'POST', origin, host,
    contentType: 'application/x-www-form-urlencoded',
    body: 'token=' + encodeURIComponent(token),
  });
  return result;
}

test('development defaults to loopback and refuses network-wide binds', () => {
  assert.equal(gateway().bindHost, '127.0.0.1');
  assert.throws(() => gateway({ NEXUS_BIND_HOST: '0.0.0.0' }), /refuses a non-loopback bind/);
  assert.throws(() => gateway({ NEXUS_BIND_HOST: '192.168.1.4' }), /refuses a non-loopback bind/);
});

test('production and remote origins require strong access credentials', () => {
  assert.throws(() => gateway({ NODE_ENV: 'production' }), /NEXUS_OWNER_TOKEN is required/);
  assert.throws(() => gateway({ NEXUS_PUBLIC_ORIGIN: 'https://agent.example.com' }), /required/);
  assert.throws(() => gateway({ NEXUS_OWNER_TOKEN: 'short' }), /32/);
  assert.throws(() => gateway({ NEXUS_OWNER_TOKEN: OWNER_TOKEN, NEXUS_PUBLIC_ORIGIN: 'http://agent.example.com' }), /HTTPS origin/);
  assert.throws(() => gateway({ NEXUS_OWNER_TOKEN: OWNER_TOKEN, NEXUS_PUBLIC_ORIGIN: 'https://agent.example.com/path' }), /bare HTTPS origin/);
});

test('credential-free development is loopback-only; hostile hosts/origins are denied', async () => {
  const g = gateway();
  assert.equal((await hit(g, { path: '/api/terminal' })).passed, true);
  assert.equal((await hit(g, { path: '/api/terminal', remoteAddress: '192.168.1.12' })).status, 401);
  assert.equal((await hit(g, { path: '/api/terminal', host: 'attacker.example.com' })).status, 421);
  assert.equal((await hit(g, { path: '/api/terminal', origin: 'https://attacker.example.com' })).status, 403);
  assert.equal((await hit(g, { path: '/api/terminal', fetchSite: 'cross-site' })).status, 403);
});

test('all protected owner API routes reject requests without an owner session', async () => {
  const g = gateway({ NODE_ENV: 'production', NEXUS_OWNER_TOKEN: OWNER_TOKEN });
  for (const path of ['/api/terminal', '/api/computer-control', '/api/permissions', '/api/tools', '/api/browser', '/api/agent/start', '/api/mobile']) {
    assert.equal((await hit(g, { path })).status, 401, path);
  }
  assert.equal((await hit(g, { path: '/' })).status, 303);
  assert.equal((await hit(g, { path: '/api/health' })).passed, true);
  assert.equal((await hit(g, { path: '/api/devices/runner' })).passed, true);
  assert.equal((await hit(g, { path: '/api/devices/mobile-runner' })).passed, true);
  assert.equal((await hit(g, { path: '/access' })).status, 200);
});

test('login issues a session-only HttpOnly cookie after explicit token entry', async () => {
  const g = gateway({ NODE_ENV: 'production', NEXUS_OWNER_TOKEN: OWNER_TOKEN });
  const incorrect = await login(g, { token: 'wrong' });
  assert.equal(incorrect.status, 200);
  assert.equal(incorrect.headers['Set-Cookie'], undefined);
  const result = await login(g);
  assert.equal(result.status, 303);
  assert.match(result.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);
  assert.equal(result.headers['Set-Cookie'].includes(OWNER_TOKEN), false);
  const cookie = result.headers['Set-Cookie'].split(';')[0];
  assert.equal((await hit(g, { path: '/api/terminal', cookie })).passed, true);
  assert.equal((await hit(g, { path: '/api/terminal', cookie: cookie + 'tampered' })).status, 401);
});

test('owner write requests must carry a matching Origin, even with session', async () => {
  const g = gateway({ NODE_ENV: 'production', NEXUS_OWNER_TOKEN: OWNER_TOKEN });
  const cookie = (await login(g)).headers['Set-Cookie'].split(';')[0];
  assert.equal((await hit(g, { path: '/api/permissions', method: 'POST', cookie })).status, 403);
  assert.equal((await hit(g, { path: '/api/permissions', method: 'POST', cookie, origin: 'https://evil.example' })).status, 403);
  assert.equal((await hit(g, { path: '/api/permissions', method: 'POST', cookie, origin: 'http://localhost:3000' })).passed, true);
  assert.equal((await login(g, { origin: 'https://evil.example' })).status, 403);
});

test('owner WebSockets require both session and same-origin browser handshake', async () => {
  const g = gateway({ NODE_ENV: 'production', NEXUS_OWNER_TOKEN: OWNER_TOKEN });
  assert.equal(g.guardUpgrade(request({ path: '/api/control', origin: 'http://localhost:3000' }), '/api/control'), false);
  const cookie = (await login(g)).headers['Set-Cookie'].split(';')[0];
  assert.equal(g.guardUpgrade(request({ path: '/api/control', cookie, origin: 'http://localhost:3000' }), '/api/control'), true);
  assert.equal(g.guardUpgrade(request({ path: '/api/live', cookie }), '/api/live'), false);
  assert.equal(g.guardUpgrade(request({ path: '/api/live', cookie, origin: 'https://evil.example' }), '/api/live'), false);
  assert.equal(g.guardUpgrade(request({ path: '/api/control', cookie, origin: 'http://localhost:3000', fetchSite: 'cross-site' }), '/api/control'), false);
});

test('native device pairing maintains a separate mandatory token boundary', () => {
  const g = gateway({ NODE_ENV: 'production', NEXUS_OWNER_TOKEN: OWNER_TOKEN });
  assert.equal(g.guardUpgrade(request({ path: '/api/device-bridge' }), '/api/device-bridge'), false);
  assert.equal(g.guardUpgrade(request({ path: '/api/device-bridge?token=nxs_sample' }), '/api/device-bridge'), true);
  assert.equal(g.guardUpgrade(request({ path: '/api/device-bridge?token=nxs_sample', origin: 'https://evil.example' }), '/api/device-bridge'), false);
});

test('HTTPS public origin gets Secure cookie and rejects wrong Host', async () => {
  const g = gateway({ NODE_ENV: 'production', NEXUS_OWNER_TOKEN: OWNER_TOKEN, NEXUS_PUBLIC_ORIGIN: 'https://agent.example.com' });
  const result = await login(g, { origin: 'https://agent.example.com', host: 'agent.example.com' });
  assert.equal(result.status, 303);
  assert.match(result.headers['Set-Cookie'], /; Secure/);
  const cookie = result.headers['Set-Cookie'].split(';')[0];
  assert.equal((await hit(g, { path: '/api/terminal', host: 'agent.example.com', cookie })).passed, true);
  assert.equal((await hit(g, { path: '/api/terminal', host: 'malicious.example.com', cookie })).status, 421);
});

test('logout revokes active session and login limits repeated attempts', async () => {
  const g = gateway({ NODE_ENV: 'production', NEXUS_OWNER_TOKEN: OWNER_TOKEN });
  const cookie = (await login(g)).headers['Set-Cookie'].split(';')[0];
  assert.equal((await hit(g, { path: '/access/logout', method: 'POST', origin: 'http://localhost:3000', cookie })).status, 303);
  assert.equal((await hit(g, { path: '/api/terminal', cookie })).status, 401);
  for (let i = 0; i < 6; i++) assert.equal((await login(g, { token: 'wrong' })).status, 200);
  assert.equal((await login(g, { token: OWNER_TOKEN })).status, 429);
});

test('logout terminates already-authenticated control and Live sockets', async () => {
  const g = gateway({ NODE_ENV: 'production', NEXUS_OWNER_TOKEN: OWNER_TOKEN });
  const cookie = (await login(g)).headers['Set-Cookie'].split(';')[0];
  let terminated = 0;
  const socket = {
    once() {},
    terminate() { terminated++; },
    close() {},
  };
  g.registerOwnerSocket(socket, request({ path: '/api/control', cookie, origin: 'http://localhost:3000' }));
  const revoked = await hit(g, {
    path: '/access/logout', method: 'POST', cookie, origin: 'http://localhost:3000',
  });
  assert.equal(revoked.status, 303);
  assert.equal(terminated, 1);
  assert.equal(g.guardUpgrade(request({ path: '/api/control', cookie, origin: 'http://localhost:3000' }), '/api/control'), false);
});
