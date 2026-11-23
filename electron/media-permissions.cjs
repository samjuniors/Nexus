'use strict';

// Adapted from SamjuniorsOS's session-scoped microphone consent pattern.
// Nexus additionally supports camera eyes, so audio and video are approved separately.
function configureMediaPermissions({ targetSession, getWindow, dialog, origin }) {
  const grants = { microphone: false, camera: false };
  const pending = new Map();

  function safeOrigin(url) {
    try { return new URL(url).origin; } catch { return null; }
  }

  function isTrusted(webContents, candidate, details = {}) {
    const win = getWindow();
    if (!win || win.isDestroyed() || win.webContents !== webContents || details.isMainFrame === false) return false;
    const frameUrl = webContents.getURL();
    return safeOrigin(frameUrl) === origin && safeOrigin(candidate || frameUrl) === origin;
  }

  function requestedKinds(permission, details = {}) {
    if (permission === 'microphone' || permission === 'audioCapture') return ['microphone'];
    if (permission === 'camera' || permission === 'videoCapture') return ['camera'];
    if (permission !== 'media') return null;
    const mediaTypes = Array.isArray(details.mediaTypes)
      ? details.mediaTypes
      : (typeof details.mediaType === 'string' ? [details.mediaType] : []);
    if (!mediaTypes.length || mediaTypes.some(type => type !== 'audio' && type !== 'video')) return null;
    return [...new Set(mediaTypes.map(type => type === 'audio' ? 'microphone' : 'camera'))];
  }

  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) => {
    if (permission === 'display-capture') return isTrusted(webContents, requestingOrigin, details);
    const kinds = requestedKinds(permission, details);
    if (kinds) return isTrusted(webContents, requestingOrigin, details) &&
      kinds.every(kind => grants[kind]);
    // No elevated permissions for embedded, remote, or untrusted renderers.
    return isTrusted(webContents, requestingOrigin, details) &&
      (permission === 'notifications' || permission === 'mediaKeySystem');
  });

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    const requestUrl = details.requestingUrl || details.securityOrigin || webContents?.getURL?.();
    if (!isTrusted(webContents, requestUrl, details)) { callback(false); return; }
    if (permission === 'display-capture') { callback(true); return; } // source picker is separate
    const kinds = requestedKinds(permission, details);
    if (!kinds) {
      callback(permission === 'notifications' || permission === 'mediaKeySystem');
      return;
    }
    if (kinds.every(kind => grants[kind])) { callback(true); return; }
    const key = kinds.slice().sort().join('+');
    if (!pending.has(key)) {
      const win = getWindow();
      const label = kinds.length === 2 ? 'microphone and camera' :
        (kinds[0] === 'camera' ? 'camera' : 'microphone');
      const request = dialog.showMessageBox(win, {
        type: 'question',
        title: 'Eva ' + label + ' permission',
        message: 'Allow Eva to use your ' + label + ' for this session?',
        detail: 'Captured audio/video may be sent to the configured AI provider while the feature is active. You can stop the feature in Nexus. Screen sharing requires separate source selection.',
        buttons: ['Not now', 'Allow for this session'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }).then(answer => answer.response === 1).catch(() => false)
        .finally(() => pending.delete(key));
      pending.set(key, request);
    }
    const currentWindow = getWindow();
    pending.get(key).then(approved => {
      const stillTrusted = currentWindow === getWindow() &&
        isTrusted(webContents, requestUrl, details);
      if (approved && stillTrusted) for (const kind of kinds) grants[kind] = true;
      callback(Boolean(approved && stillTrusted));
    }).catch(() => callback(false));
  });

  return { reset: () => { grants.microphone = false; grants.camera = false; } };
}

module.exports = { configureMediaPermissions };
