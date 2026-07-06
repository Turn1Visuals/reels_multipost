const { app } = require('electron')
const fs = require('fs')
const path = require('path')

function prefsPath() {
  return path.join(app.getPath('userData'), 'prefs.json')
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(prefsPath(), 'utf8'))
  } catch (err) {
    return {}
  }
}

function save(prefs) {
  fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2))
}

module.exports = { load, save }
