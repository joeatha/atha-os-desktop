'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const target = process.argv[2];
const outPath = process.argv[3];
const w = parseInt(process.argv[4] || '960', 10);
const h = parseInt(process.argv[5] || '900', 10);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: w, height: h, show: false, webPreferences: {} });
  try {
    await win.loadFile(target);
  } catch (e) {
    console.error('load failed', e && e.message);
  }
  await new Promise((r) => setTimeout(r, 1800)); // let fonts/layout settle
  const img = await win.webContents.capturePage();
  const resized = img.resize({ width: w }); // normalize to logical width
  fs.writeFileSync(outPath, resized.toPNG());
  console.log('wrote', outPath, resized.getSize());
  app.exit(0);
});
