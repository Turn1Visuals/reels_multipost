const credentials = require('./credentials')

module.exports = {
  id: 'tiktok',
  name: 'TikTok (draft)',
  isConfigured: () => credentials.forPlatform('tiktok') !== null,
  post: async ({ videoPath, meta }) => {
    throw new Error('TikTok is not wired up yet — add credentials in config/credentials.json first')
  }
}
