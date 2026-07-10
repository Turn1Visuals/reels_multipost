const settings = require('../settings')

// Instagram and Facebook share one Meta developer app
const sectionForPlatform = {
  youtube: 'youtube',
  tiktok: 'tiktok',
  instagram: 'meta',
  facebook: 'meta',
  x: 'x',
  mastodon: 'mastodon',
  bluesky: 'bluesky',
  whatsapp: 'whatsapp'
}

function forPlatform(id) {
  const section = settings.load()[sectionForPlatform[id]]
  if (!section) return null
  const values = Object.values(section)
  if (values.length === 0 || values.some((v) => !v)) return null
  return section
}

module.exports = { forPlatform }
