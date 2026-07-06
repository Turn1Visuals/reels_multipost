const credentials = require('./credentials')

module.exports = {
  id: 'instagram',
  name: 'Instagram',
  isConfigured: () => credentials.forPlatform('instagram') !== null,
  post: async ({ videoPath, meta }) => {
    throw new Error('Instagram is not wired up yet')
  }
}
