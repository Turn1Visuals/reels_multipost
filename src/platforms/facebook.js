const credentials = require('./credentials')

module.exports = {
  id: 'facebook',
  name: 'Facebook',
  isConfigured: () => credentials.forPlatform('facebook') !== null,
  post: async ({ videoPath, meta }) => {
    throw new Error('Facebook is not wired up yet')
  }
}
