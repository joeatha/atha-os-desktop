'use strict';

// Answers ONE question about a built shell, without needing to see the screen:
// does it actually have a usable platform authenticator?
//
// This is the exact capability the web app gates on
// (isUserVerifyingPlatformAuthenticatorAvailable) and the thing Electron 33 lacked.
// It must be run against a SIGNED build — the keychain-access-groups entitlement only
// takes effect when the app is code-signed, so an unsigned run proves nothing.
//
//   node scripts/authenticator-probe.js "/path/to/Atha OS.app"
//
// Serves a page on localhost, launches the app pointed at it with its own
// --user-data-dir (so it does not fight the running copy's single-instance lock),
// and prints what the renderer reports. Exits non-zero if no authenticator.

const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const appPath = process.argv[2];
if (!appPath) {
  console.error('usage: node scripts/authenticator-probe.js "/path/to/Atha OS.app"');
  process.exit(2);
}
const binary = path.join(appPath, 'Contents', 'MacOS', 'Atha OS');

const PAGE = `<!doctype html><meta charset="utf-8"><title>probe</title>
<body style="font:14px system-ui;padding:24px;background:#111;color:#eee">
<h1 id="h">probing...</h1>
<script>
(async () => {
  const out = { electron: navigator.userAgent, hasPKC: !!window.PublicKeyCredential };
  try {
    out.uvpaa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch (e) { out.uvpaa = 'threw: ' + e.message; }
  try {
    out.conditional = await PublicKeyCredential.isConditionalMediationAvailable();
  } catch (e) { out.conditional = 'threw: ' + e.message; }
  document.getElementById('h').textContent = JSON.stringify(out);
  await fetch('/result', { method: 'POST', body: JSON.stringify(out) });
})();
</script>`;

let done = false;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.end('ok');
      report(JSON.parse(body));
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});

function report(r) {
  if (done) return;
  done = true;
  console.log('\n--- renderer reported ---');
  console.log('  Electron UA        :', /Electron\/([\d.]+)/.exec(r.electron)?.[1] || '?');
  console.log('  PublicKeyCredential:', r.hasPKC);
  console.log('  platform auth avail:', r.uvpaa);
  console.log('  conditional avail  :', r.conditional);
  const ok = r.uvpaa === true;
  console.log(ok
    ? '\nPASS — a platform authenticator IS available; passkeys can work in the app'
    : '\nFAIL — no platform authenticator; a passkey ceremony would abort with no prompt');
  child.kill('SIGTERM');
  server.close();
  process.exit(ok ? 0 : 1);
}

const child = { kill() {} };
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log('probe server at', url);

  // Pre-seed autoLaunch:false in the throwaway userData. Login items are keyed by
  // EXECUTABLE PATH, so a probe run out of dist/ looks "not enabled" to
  // autolaunch.init(), which would helpfully register THIS build to open at login
  // and leave a stray login item behind on a machine we are only measuring.
  const dataDir = `/tmp/atha-probe-${process.pid}`;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ autoLaunch: false }));

  const proc = spawn(binary, [`--user-data-dir=${dataDir}`], {
    env: { ...process.env, ATHAOS_DEV: '1', ATHAOS_URL: url },
    stdio: 'inherit',
  });
  child.kill = (sig) => { try { proc.kill(sig); } catch (_) {} };
  proc.on('exit', (code) => {
    if (!done) {
      console.error(`\nFAIL — app exited (code ${code}) before reporting`);
      server.close();
      process.exit(1);
    }
  });
  setTimeout(() => {
    if (!done) {
      console.error('\nFAIL — no report within 45s');
      child.kill('SIGTERM');
      server.close();
      process.exit(1);
    }
  }, 45000);
});
