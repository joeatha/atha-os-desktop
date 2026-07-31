'use strict';

// Renders the screen-share source picker (src/picker.html) in isolation with
// stub sources so the UI can be verified without the OS screen-recording grant.
//
//   npx electron scripts/picker-test.js

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');

const OUT = path.join(__dirname, '..', 'dist', 'picker-ui.png');
const CHANNEL = 'athaos:picker';

function swatch(w, h, hex) {
  // Solid-colour PNG stand-in for a capture thumbnail.
  const buf = Buffer.alloc(w * h * 4);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < w * h; i++) buf.set([r, g, b, 255], i * 4);
  return nativeImage.createFromBuffer(buf, { width: w, height: h }).toDataURL();
}

const SOURCES = [
  { id: 'screen:0', name: 'Entire Screen', kind: 'screen', thumbnail: swatch(320, 200, '#1d4ed8'), appIcon: null },
  { id: 'screen:1', name: 'Display 2', kind: 'screen', thumbnail: swatch(320, 200, '#0f766e'), appIcon: null },
  { id: 'window:1', name: 'Google Chrome — Atha OS Dashboard', kind: 'window', thumbnail: swatch(320, 200, '#7c3aed'), appIcon: swatch(16, 16, '#f36f21') },
  { id: 'window:2', name: 'Numbers — July Delinquency.numbers', kind: 'window', thumbnail: swatch(320, 200, '#b45309'), appIcon: null },
  { id: 'window:3', name: 'A window with a really long title that has to be truncated somewhere', kind: 'window', thumbnail: null, appIcon: null },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  ipcMain.handle(`${CHANNEL}:sources`, () => SOURCES);
  const chosen = new Promise((resolve) => ipcMain.on(`${CHANNEL}:choose`, (_e, id) => resolve(id)));

  const win = new BrowserWindow({
    width: 760,
    height: 560,
    show: false,
    backgroundColor: '#0f1729',
    title: 'Atha OS — Choose what to share',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'picker-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'picker.html'));
  await wait(900);

  const state = await win.webContents.executeJavaScript(`
    ({ cards: document.querySelectorAll('.card').length,
       activeTab: document.querySelector('.tab[aria-selected="true"]').textContent,
       shareDisabled: document.getElementById('share').disabled,
       bridge: typeof window.athaPicker })
  `);
  console.log('initial:', JSON.stringify(state));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, (await win.webContents.capturePage()).toPNG());
  console.log('screenshot ->', OUT);

  // Switch to the Window tab, select a source, confirm.
  await win.webContents.executeJavaScript(`document.getElementById('tab-window').click()`);
  await wait(250);
  const windowTab = await win.webContents.executeJavaScript(`
    ({ cards: document.querySelectorAll('.card').length,
       shareDisabled: document.getElementById('share').disabled })
  `);
  console.log('window tab:', JSON.stringify(windowTab));

  await win.webContents.executeJavaScript(`document.querySelector('.card').click()`);
  await wait(150);
  const selected = await win.webContents.executeJavaScript(`
    ({ pressed: document.querySelector('.card[aria-pressed="true"]')?.dataset.id,
       shareDisabled: document.getElementById('share').disabled })
  `);
  console.log('after select:', JSON.stringify(selected));

  await win.webContents.executeJavaScript(`document.getElementById('share').click()`);
  const id = await chosen;
  console.log('chose:', id);

  const pass =
    state.cards === 2 &&
    state.bridge === 'object' &&
    state.shareDisabled === true &&
    windowTab.cards === 3 &&
    selected.shareDisabled === false &&
    id === 'window:1';
  console.log(pass ? 'PASS' : 'FAIL');
  app.exit(pass ? 0 : 1);
});
