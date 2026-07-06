const { app } = require('electron')
const fs = require('fs')
const path = require('path')

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function load() {
  const file = settingsPath()
  if (!fs.existsSync(file)) return {}
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function save(settings) {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
}

module.exports = { load, save }
