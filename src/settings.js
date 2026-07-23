'use strict';

// Minimal JSON-file settings store in userData (no extra dependency).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');

let cache = null;
let file = null;

function filePath() {
  if (!file) file = path.join(app.getPath('userData'), 'settings.json');
  return file;
}

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(cache, null, 2));
  } catch (e) {
    log.error('settings save failed', e);
  }
}

function get(key, fallback) {
  const v = load()[key];
  return v === undefined ? fallback : v;
}

function set(key, value) {
  load();
  cache[key] = value;
  save();
}

module.exports = { get, set };
