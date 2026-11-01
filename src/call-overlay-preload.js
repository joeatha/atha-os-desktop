'use strict';

// Bridge for the incoming-call pop-up (src/call-overlay.html). Sandboxed: the
// pop-up gets the caller's name/number and two buttons, nothing else.

const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'athaos:overlay';

contextBridge.exposeInMainWorld('athaCallOverlay', {
  // info: { name?: string, from?: string } — the IPC event never crosses over.
  onInfo(cb) {
    if (typeof cb !== 'function') return;
    ipcRenderer.on(`${CHANNEL}:info`, (_e, info) => { try { cb(info); } catch (_) {} });
  },
  answer: () => ipcRenderer.send(`${CHANNEL}:answer`),
  decline: () => ipcRenderer.send(`${CHANNEL}:decline`),
});
