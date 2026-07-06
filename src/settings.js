const { app } = require('electron')
const fs = require('fs')
const path = require('path')

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function load() {
  const file = settingsPath()
  if (!fs.existsSync(file)) return {}
  // strip a UTF-8 BOM if an external editor left one behind
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
}

function save(settings) {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
}

module.exports = { load, save }
