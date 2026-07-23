'use strict';

// Preload runs in an isolated world but shares the page DOM. It exposes a tiny,
// explicit bridge to the remote Atha OS page — NO Node access is handed to the
// remote content. The remote page is treated as untrusted.

const { contextBridge, ipcRenderer } = require('electron');

// --- Explicit API the web app may call ---------------------------------------
// The web app can feature-detect `window.athaDesktop` to know it's in the shell.
contextBridge.exposeInMainWorld('athaDesktop', {
  isDesktop: true,
  version: ipcRenderer.sendSync('athaos:get-version'),

  // Softphone tells the shell a call is ringing → native notification + window focus.
  // info: { from?: string, name?: string }
  incomingCall(info) {
    ipcRenderer.send('athaos:incoming-call', sanitize(info));
  },

  // Softphone pushes Twilio Device registration state → tray icon/status.
  // state: 'registered' | 'registering' | 'offline' | 'error'
  setPhonePresence(state) {
    ipcRenderer.send('athaos:phone-presence', String(state || 'offline'));
  },

  // Optional: let the page clear a pending incoming-call notification.
  callAnswered() {
    ipcRenderer.send('athaos:call-answered');
  },
});

// --- DOM-event fallback ------------------------------------------------------
// So the softphone can integrate with zero coupling to the bridge object:
// window.dispatchEvent(new CustomEvent('athaos:incoming-call', { detail: { from } }))
// window.dispatchEvent(new CustomEvent('athaos:phone-presence', { detail: 'registered' }))
window.addEventListener('athaos:incoming-call', (e) => {
  ipcRenderer.send('athaos:incoming-call', sanitize(e && e.detail));
});
window.addEventListener('athaos:phone-presence', (e) => {
  const d = e && e.detail;
  ipcRenderer.send('athaos:phone-presence', String((d && d.state) || d || 'offline'));
});

function sanitize(info) {
  info = info || {};
  const clip = (v) => (typeof v === 'string' ? v.slice(0, 120) : undefined);
  return { from: clip(info.from), name: clip(info.name) };
}
