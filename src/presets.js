const { app } = require('electron')
const fs = require('fs')
const path = require('path')

function presetsPath() {
  return path.join(app.getPath('userData'), 'presets.json')
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(presetsPath(), 'utf8'))
  } catch (err) {
    return { lastSelected: '', presets: {} }
  }
}

function save(data) {
  fs.writeFileSync(presetsPath(), JSON.stringify(data, null, 2))
}

module.exports = { load, save }
