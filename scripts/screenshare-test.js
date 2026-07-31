'use strict';

// End-to-end harness for the screen-share path (src/screenshare.js).
// Loads a page that calls getDisplayMedia(), drives the source picker
// programmatically, screenshots it, and reports the resulting track.
//
//   npx electron scripts/screenshare-test.js [--cancel]
//
// Exits non-zero if the flow doesn't produce a video track (or, with --cancel,
// if cancelling doesn't cleanly reject).

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session, systemPreferences } = require('electron');
const screenshare = require('../src/screenshare');

const CANCEL = process.argv.includes('--cancel');
const OUT = path.join(__dirname, '..', 'dist', 'screenshare-picker.png');

const TEST_PAGE = `data:text/html,${encodeURIComponent(`
  <body><script>
    window.__result = null;
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      .then((s) => {
        const t = s.getVideoTracks()[0];
        window.__result = { ok: true, label: t && t.label, settings: t && t.getSettings() };
      })
      .catch((e) => { window.__result = { ok: false, error: e.name + ': ' + e.message }; });
  </script></body>
`)}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  console.log('screen access status:', screenshare.screenAccessStatus());
  console.log('raw getMediaAccessStatus:', systemPreferences.getMediaAccessStatus?.('screen'));

  const ses = session.fromPartition('test:screenshare');
  screenshare.init(ses, () => null);

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: { partition: 'test:screenshare' },
  });
  await win.loadURL(TEST_PAGE);

  // Wait for the picker window to appear.
  let picker = null;
  for (let i = 0; i < 60 && !picker; i++) {
    await wait(250);
    picker = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('Choose what to share'));
  }
  if (!picker) {
    console.error('FAIL: picker never opened');
    console.error('page result:', await win.webContents.executeJavaScript('window.__result'));
    return app.exit(1);
  }

  await wait(1200); // let thumbnails paint
  const shot = await picker.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, shot.toPNG());
  console.log('picker screenshot ->', OUT);

  const counts = await picker.webContents.executeJavaScript(`
    ({ screens: document.querySelectorAll('.card').length,
       tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent),
       shareDisabled: document.getElementById('share').disabled })
  `);
  console.log('picker state:', JSON.stringify(counts));

  if (CANCEL) {
    await picker.webContents.executeJavaScript(`document.getElementById('cancel').click()`);
  } else {
    await picker.webContents.executeJavaScript(`
      document.querySelector('.card').click();
      document.getElementById('share').click();
    `);
  }

  let result = null;
  for (let i = 0; i < 40 && !result; i++) {
    await wait(250);
    result = await win.webContents.executeJavaScript('window.__result');
  }
  console.log('page result:', JSON.stringify(result));

  const pass = CANCEL
    ? result && result.ok === false && /NotAllowed|Permission|aborted/i.test(result.error || '')
    : result && result.ok === true && result.settings && result.settings.width > 0;
  console.log(pass ? 'PASS' : 'FAIL');
  app.exit(pass ? 0 : 1);
});
