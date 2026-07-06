const { app } = require('electron')
const fs = require('fs')
const path = require('path')

function tokenPath(platformId) {
  return path.join(app.getPath('userData'), 'tokens', platformId + '.json')
}

function load(platformId) {
  const file = tokenPath(platformId)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function save(platformId, data) {
  const file = tokenPath(platformId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function remove(platformId) {
  const file = tokenPath(platformId)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

module.exports = { load, save, remove }
