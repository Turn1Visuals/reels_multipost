const youtube = require('./youtube')
const tiktok = require('./tiktok')
const instagram = require('./instagram')
const facebook = require('./facebook')
const x = require('./x')
const threads = require('./threads')
const whatsapp = require('./whatsapp')

const all = [youtube, tiktok, instagram, facebook, x, threads, whatsapp]

module.exports = {
  list: () => all,
  get: (id) => all.find((p) => p.id === id)
}
