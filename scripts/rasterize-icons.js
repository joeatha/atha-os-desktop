'use strict';

// One-off asset renderer. Uses Electron's offscreen renderer to rasterize the
// Atha OS brand mark (from the dashboard's atha-icon-src.svg) into the app icon
// and tray icons with real transparency. Run: `npx electron scripts/rasterize-icons.js`

const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT_ASSETS = path.join(__dirname, '..', 'assets');
const OUT_BUILD = path.join(__dirname, '..', 'build');

// Full app icon: rounded-rect background + orange mark (matches the web app icon).
const APP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#111317"/>
  <g transform="translate(142.8,106) scale(1.9439)">
    <path fill="#ff6d00" d="M83,33.39c0-2.07,0-2.1-3.18-2.1l-44.73-.05L114.36.1c.55-.21,1.17-.09,1.61.31.43.4.61,1,.46,1.57l-33.43,108.64V33.39Z"/>
    <path fill="#ff6d00" d="M33.48,120.94c0,2.07,0,2.1,3.18,2.1l44.73.05L2.12,154.22c-.55.21-1.17.09-1.61-.31-.43-.4-.61-1-.46-1.57L33.48,43.71v77.23Z"/>
  </g>
</svg>`;

// Tray: mark only, no background, square viewBox framing the mark (no distortion).
function traySvg(fill) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="85 86 340 340">
    <g transform="translate(142.8,106) scale(1.9439)">
      <path fill="${fill}" d="M83,33.39c0-2.07,0-2.1-3.18-2.1l-44.73-.05L114.36.1c.55-.21,1.17-.09,1.61.31.43.4.61,1,.46,1.57l-33.43,108.64V33.39Z"/>
      <path fill="${fill}" d="M33.48,120.94c0,2.07,0,2.1,3.18,2.1l44.73.05L2.12,154.22c-.55.21-1.17.09-1.61-.31-.43-.4-.61-1-.46-1.57L33.48,43.71v77.23Z"/>
    </g>
  </svg>`;
}

async function render(svg, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: {},
  });
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  win.destroy();
  return img;
}

function write(file, img, target) {
  const out = img.resize({ width: target, height: target, quality: 'best' });
  fs.writeFileSync(file, out.toPNG());
  console.log('wrote', path.basename(file), out.getSize());
}

async function safeRender(svg, renderAt) {
  try {
    return await render(svg, renderAt);
  } catch (e) {
    console.error('render failed:', e && e.message);
    return null;
  }
}

// Render ONE icon per process — creating a second transparent window crashes
// the GPU process on some macOS setups. The shell driver calls this 3x.
const MODE = process.argv[2] || 'app';

app.whenReady().then(async () => {
  if (MODE === 'app') {
    const img = await safeRender(APP_SVG, 512);
    if (img) write(path.join(OUT_BUILD, 'icon.png'), img, 1024);
  } else if (MODE === 'active' || MODE === 'idle') {
    const fill = MODE === 'active' ? '#ff6d00' : '#9aa0a6';
    const name = MODE === 'active' ? 'tray-active' : 'tray-idle';
    const img = await safeRender(traySvg(fill), 88);
    if (img) {
      write(path.join(OUT_ASSETS, `${name}.png`), img, 22);
      write(path.join(OUT_ASSETS, `${name}@2x.png`), img, 44);
    }
  }
  app.exit(0);
});
