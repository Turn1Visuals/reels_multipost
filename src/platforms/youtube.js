const credentials = require('./credentials')

module.exports = {
  id: 'youtube',
  name: 'YouTube',
  isConfigured: () => credentials.forPlatform('youtube') !== null,
  post: async ({ videoPath, meta }) => {
    throw new Error('YouTube is not wired up yet — add credentials in config/credentials.json first')
  }
}
