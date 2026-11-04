// Which permission requests the desktop window grants (src/config.js isPermissionAllowed).
// Atha OS Dev item 013765ab (Justin Norris, 2026-11-02): a training video's full-screen
// button did nothing in the desktop app, because 'fullscreen' was denied for every frame.
//
//   node tests/permissions.test.js
//
// Hermetic: config.js has no electron dependency.
'use strict';
const assert = require('assert');
const { isPermissionAllowed } = require('../src/config');

// Full screen: any frame, including an embedded YouTube/Loom player in an Academy lesson.
assert.strictEqual(isPermissionAllowed('fullscreen', 'https://pmione.com/#academy'), true, 'fullscreen on our own page');
assert.strictEqual(isPermissionAllowed('fullscreen', 'https://www.youtube.com/embed/abc'), true, 'fullscreen from an embedded player');
assert.strictEqual(isPermissionAllowed('fullscreen', ''), true, 'fullscreen with no requesting url');

// Camera/mic/screen stay limited to our hosts and meeting hosts.
assert.strictEqual(isPermissionAllowed('media', 'https://pmione.com/'), true, 'mic for the softphone');
assert.strictEqual(isPermissionAllowed('media', 'https://meet.google.com/xyz'), true, 'camera in Meet');
assert.strictEqual(isPermissionAllowed('media', 'https://www.youtube.com/embed/abc'), false, 'no mic for a video embed');
assert.strictEqual(isPermissionAllowed('display-capture', 'https://evil.example.com/'), false, 'no screen capture for an outside site');
assert.strictEqual(isPermissionAllowed('media', 'not a url'), false, 'bad url denied');

// Anything else stays denied.
assert.strictEqual(isPermissionAllowed('geolocation', 'https://pmione.com/'), false, 'geolocation denied');
assert.strictEqual(isPermissionAllowed('clipboard-read', 'https://pmione.com/'), false, 'clipboard-read denied');

console.log('permissions: ok');
