'use strict';

// Nexus owner ingress boundary. No framework or Electron dependency.
// All browser/API and owner WebSocket ingress is checked before Next.js.
// Device bridges have their own per-device token and are handled separately.
const crypto = require('node:crypto');

const COOKIE = 'nexus_owner_session';
const MAX_AGE_SECONDS = 12 * 60 * 60;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 6;

function localAddress(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function makeOrigin(url) {
  try { return new URL(url).origin; } catch { return null; }
}

function constantTimeTextEquals(a, b) {
  const lhs = crypto.createHash('sha256').update(String(a)).digest();
  const rhs = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(lhs, rhs);
}

function parseCookie(header, name) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0 || part.slice(0, idx).trim() !== name) continue;
    return part.slice(idx + 1).trim();
  }
  return null;
}

function createOwnerGateway({ env = process.env, port = 3000 } = {}) {
  const bindHost = (env.NEXUS_BIND_HOST || '127.0.0.1').trim().toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(bindHost)) {
    throw new Error('Nexus refuses a non-loopback bind. Use a trusted HTTPS reverse proxy to 127.0.0.1 and NEXUS_PUBLIC_ORIGIN.');
  }
  const ownerToken = (env.NEXUS_OWNER_TOKEN || '').trim();
  const publicOriginValue = (env.NEXUS_PUBLIC_ORIGIN || '').trim();
  if (ownerToken && (ownerToken.length < 32 || ownerToken.length > 512)) {
    throw new Error('NEXUS_OWNER_TOKEN must be a unique 32–512 character secret.');
  }
  if ((env.NODE_ENV === 'production' || publicOriginValue) && !ownerToken) {
    throw new Error('NEXUS_OWNER_TOKEN is required in production and for remote HTTPS access.');
  }

  let publicUrl = null;
  if (publicOriginValue) {
    try { publicUrl = new URL(publicOriginValue); } catch {
      throw new Error('NEXUS_PUBLIC_ORIGIN must be an HTTPS origin.');
    }
    if (publicUrl.protocol !== 'https:' || publicUrl.origin !== publicOriginValue ||
      publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' ||
      publicUrl.search || publicUrl.hash) {
      throw new Error('NEXUS_PUBLIC_ORIGIN must be a bare HTTPS origin, without paths or credentials.');
    }
  }

  const localHosts = new Map([
    ['localhost:' + port, 'http://localhost:' + port],
    ['127.0.0.1:' + port, 'http://127.0.0.1:' + port],
    ['[::1]:' + port, 'http://[::1]:' + port],
  ]);
  const macKey = crypto.randomBytes(32);
  const failures = new Map();
  const revoked = new Set();

  function requestOrigin(req) {
    const host = String(req.headers.host || '').toLowerCase();
    if (publicUrl && host === publicUrl.host.toLowerCase()) return publicUrl.origin;
    return localHosts.get(host) || null;
  }

  function isTrustedRequest(req, expected, { requireOrigin = false } = {}) {
    if (!expected) return false;
    const origin = req.headers.origin;
    if (origin && makeOrigin(origin) !== expected) return false;
    if (requireOrigin && !origin) return false;
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
    return true;
  }

  function makeSession() {
    const id = crypto.randomBytes(24).toString('hex');
    const expiry = Date.now() + MAX_AGE_SECONDS * 1000;
    const input = id + '.' + expiry;
    const tag = crypto.createHmac('sha256', macKey).update(input).digest('hex');
    return input + '.' + tag;
  }

  function sessionIsValid(cookie) {
    if (!cookie || typeof cookie !== 'string') return false;
    const parts = cookie.split('.');
    if (parts.length !== 3 || !/^[0-9a-f]{48}$/.test(parts[0]) ||
      !/^\d{13}$/.test(parts[1]) || !/^[0-9a-f]{64}$/.test(parts[2])) return false;
    const expires = Number(parts[1]);
    if (!Number.isSafeInteger(expires) || Date.now() > expires || expires > Date.now() + MAX_AGE_SECONDS * 1000) return false;
    if (revoked.has(parts[0])) return false;
    const expected = crypto.createHmac('sha256', macKey).update(parts[0] + '.' + parts[1]).digest('hex');
    return constantTimeTextEquals(parts[2], expected);
  }

  function isAuthenticated(req) {
    // Only development over direct loopback is credential-free. Never trust forwarded IP headers.
    if (!ownerToken) return localAddress(req.socket?.remoteAddress);
    return sessionIsValid(parseCookie(req.headers.cookie, COOKIE));
  }

  function send(res, status, body, contentType = 'application/json; charset=utf-8', extra = {}) {
    res.writeHead(status, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      ...extra,
    });
    res.end(body);
  }

  function loginPage(res, invalid = false) {
    const error = invalid ? '<p role="alert">Invalid access token or too many attempts.</p>' : '';
    send(res, 200, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nexus access</title><style>body{font:16px system-ui;background:#111;color:#eee;display:grid;min-height:90vh;place-items:center}main{width:min(90vw,350px)}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px}button{cursor:pointer}</style><main><h1>Nexus</h1><p>Enter your owner access token to unlock this session.</p>' + error + '<form action="/access" method="post"><label>Owner token<input name="token" type="password" autocomplete="current-password" required></label><button type="submit">Unlock</button></form></main></html>',
      'text/html; charset=utf-8', {
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      });
  }

  async function readSmallBody(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString('utf8');
      if (body.length > 2048) throw new Error('Payload too large');
    }
    return body;
  }

  async function handleAccess(req, res, expected) {
    if (!ownerToken) {
      send(res, 404, '{"error":"Access page disabled in local development"}');
      return;
    }
    if (req.method === 'GET') { loginPage(res); return; }
    if (req.method !== 'POST' || !isTrustedRequest(req, expected, { requireOrigin: true })) {
      send(res, 403, '{"error":"Forbidden"}'); return;
    }
    if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
      send(res, 415, '{"error":"Unsupported media type"}'); return;
    }
    const ip = String(req.socket?.remoteAddress || '');
    const attempt = failures.get(ip);
    if (attempt && attempt.until > Date.now() && attempt.count >= MAX_LOGIN_FAILURES) {
      send(res, 429, '{"error":"Rate limited"}'); return;
    }
    let supplied = '';
    try { supplied = new URLSearchParams(await readSmallBody(req)).get('token') || ''; }
    catch { send(res, 413, '{"error":"Invalid request body"}'); return; }
    if (!constantTimeTextEquals(supplied, ownerToken)) {
      const current = attempt && attempt.until > Date.now() ? attempt : { count: 0, until: Date.now() + WINDOW_MS };
      current.count++;
      failures.set(ip, current);
      loginPage(res, true); return;
    }
    failures.delete(ip);
    const session = makeSession();
    const secure = expected.startsWith('https:') ? '; Secure' : '';
    send(res, 303, '', 'text/plain; charset=utf-8', {
      Location: '/',
      'Set-Cookie': COOKIE + '=' + session + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + MAX_AGE_SECONDS + secure,
    });
  }

  function handleLogout(req, res, expected) {
    if (req.method !== 'POST' || !isTrustedRequest(req, expected, { requireOrigin: true })) {
      send(res, 403, '{"error":"Forbidden"}'); return;
    }
    const session = parseCookie(req.headers.cookie, COOKIE);
    if (sessionIsValid(session)) revoked.add(session.split('.')[0]);
    send(res, 303, '', 'text/plain; charset=utf-8', {
      Location: '/access',
      'Set-Cookie': COOKIE + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' +
        (expected.startsWith('https:') ? '; Secure' : ''),
    });
  }

  async function guardHttp(req, res) {
    const expected = requestOrigin(req);
    if (!expected) { send(res, 421, '{"error":"Unexpected host"}'); return false; }
    const path = (req.url || '/').split('?')[0];
    const isApi = path === '/api' || path.startsWith('/api/');
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET');
    if ((isApi || mutating) && !isTrustedRequest(req, expected, { requireOrigin: mutating && Boolean(ownerToken) })) {
      send(res, 403, '{"error":"Cross-origin request denied"}'); return false;
    }

    if (path === '/api/health' && req.method === 'GET') return true;
    if (path === '/access') { await handleAccess(req, res, expected); return false; }
    if (path === '/access/logout') { handleLogout(req, res, expected); return false; }
    if (!isAuthenticated(req)) {
      if (isApi) send(res, 401, '{"error":"Owner session required"}');
      else send(res, 303, '', 'text/plain; charset=utf-8', { Location: '/access' });
      return false;
    }
    return true;
  }

  function guardUpgrade(req, path) {
    const expected = requestOrigin(req);
    if (!expected || !isTrustedRequest(req, expected, { requireOrigin: path !== '/api/device-bridge' })) return false;
    if (path === '/api/device-bridge') {
      // The device bridge validates the pairing token with its stored hash.
      // Do not require an owner cookie from native Android/Desktop devices.
      try {
        const url = new URL(req.url, expected);
        return Boolean(url.searchParams.get('token'));
      } catch { return false; }
    }
    return isAuthenticated(req);
  }

  return {
    bindHost,
    requiresOwnerToken: Boolean(ownerToken),
    guardHttp,
    guardUpgrade,
  };
}

module.exports = { createOwnerGateway };
