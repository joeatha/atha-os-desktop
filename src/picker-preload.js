'use strict';

// Tiny bridge for the screen-share source picker (src/picker.html). Sandboxed:
// the picker page gets a list of sources and a way to answer, nothing else.

const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'athaos:picker';

contextBridge.exposeInMainWorld('athaPicker', {
  getSources: () => ipcRenderer.invoke(`${CHANNEL}:sources`),
  choose: (id) => ipcRenderer.send(`${CHANNEL}:choose`, id),
  cancel: () => ipcRenderer.send(`${CHANNEL}:choose`, null),
});
