'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configureScreenVision } = require('./screen-vision-permissions.cjs');
const { configureMediaPermissions } = require('./media-permissions.cjs');

function fixture() {
  const frame = { url: 'http://localhost:3000/agent' };
  const wc = { mainFrame: frame, getURL: () => frame.url };
  const win = { webContents: wc, isDestroyed: () => false };
  const handlers = {};
  const targetSession = {
    setDisplayMediaRequestHandler: handler => { handlers.display = handler; },
    setPermissionRequestHandler: handler => { handlers.request = handler; },
    setPermissionCheckHandler: handler => { handlers.check = handler; },
  };
  let response = 0;
  let promptCount = 0;
  const dialog = {
    showMessageBox: async () => {
      promptCount++;
      return { response };
    },
  };
  const sources = [
    { id: 'screen:0:0', name: 'Entire Screen' },
    { id: 'window:123:0', name: 'Editor' },
    { id: 'bad:0', name: 'Unrecognized source' },
  ];
  return {
    frame, wc, win, handlers, targetSession, dialog,
    desktopCapturer: { getSources: async () => sources },
    getWindow: () => win,
    setResponse: next => { response = next; },
    promptCount: () => promptCount,
  };
}

async function display(f, frame = f.frame) {
  return new Promise((resolve, reject) => {
    Promise.resolve(f.handlers.display({ frame }, resolve)).catch(reject);
  });
}

async function permission(f, permissionKind, mediaTypes, url = 'http://localhost:3000') {
  return new Promise(resolve => {
    f.handlers.request(f.wc, permissionKind, resolve, {
      requestingUrl: url, mediaTypes, isMainFrame: true,
    });
  });
}

test('screen share is denied by default, with no automatic first-screen selection', async () => {
  const f = fixture();
  configureScreenVision({ ...f, origin: 'http://localhost:3000' });
  assert.equal(await display(f), null);
  assert.equal(f.promptCount(), 1);
});

test('explicitly chosen screen/window is returned, never audio', async () => {
  const f = fixture();
  configureScreenVision({ ...f, origin: 'http://localhost:3000' });
  f.setResponse(2);
  assert.deepEqual(await display(f), { video: { id: 'window:123:0', name: 'Editor' } });
});

test('an untrusted origin cannot display capture or show a permission prompt', async () => {
  const f = fixture();
  configureScreenVision({ ...f, origin: 'http://localhost:3000' });
  assert.equal(await display(f, { url: 'https://untrusted.example/' }), null);
  assert.equal(f.promptCount(), 0);
});

test('screen picker ignores invalid frames instead of throwing', async () => {
  const f = fixture();
  configureScreenVision({ ...f, origin: 'http://localhost:3000' });
  assert.equal(await display(f, { url: 'not a valid url' }), null);
});

test('microphone requires native approval and session grant can be reset', async () => {
  const f = fixture();
  const gate = configureMediaPermissions({ targetSession: f.targetSession, getWindow: f.getWindow, dialog: f.dialog, origin: 'http://localhost:3000' });
  assert.equal(await permission(f, 'media', ['audio']), false);
  f.setResponse(1);
  assert.equal(await permission(f, 'media', ['audio']), true);
  assert.equal(f.handlers.check(f.wc, 'media', 'http://localhost:3000', { mediaTypes: ['audio'] }), true);
  gate.reset();
  assert.equal(f.handlers.check(f.wc, 'media', 'http://localhost:3000', { mediaTypes: ['audio'] }), false);
});

test('camera permission remains available via a separate native prompt', async () => {
  const f = fixture();
  configureMediaPermissions({ targetSession: f.targetSession, getWindow: f.getWindow, dialog: f.dialog, origin: 'http://localhost:3000' });
  f.setResponse(1);
  assert.equal(await permission(f, 'media', ['video']), true);
  assert.equal(f.handlers.check(f.wc, 'media', 'http://localhost:3000', { mediaTypes: ['audio'] }), false);
  assert.equal(f.handlers.check(f.wc, 'media', 'http://localhost:3000', { mediaTypes: ['video'] }), true);
});

test('malformed, mixed-origin, or unspecified media requests fail closed', async () => {
  const f = fixture();
  configureMediaPermissions({ targetSession: f.targetSession, getWindow: f.getWindow, dialog: f.dialog, origin: 'http://localhost:3000' });
  f.setResponse(1);
  assert.equal(await permission(f, 'media', [], 'http://localhost:3000'), false);
  assert.equal(await permission(f, 'media', ['audio'], 'https://untrusted.example'), false);
  assert.equal(await permission(f, 'media', ['screen']), false);
  assert.equal(f.promptCount(), 0);
});

test('native source picker enforces originating main frame', async () => {
  const f = fixture();
  configureScreenVision({ ...f, origin: 'http://localhost:3000' });
  f.setResponse(1);
  assert.equal(await display(f, { url: 'http://localhost:3000/', other: true }), null);
});
