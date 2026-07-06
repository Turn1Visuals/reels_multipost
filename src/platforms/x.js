const credentials = require('./credentials')

module.exports = {
  id: 'x',
  name: 'X',
  isConfigured: () => credentials.forPlatform('x') !== null,
  post: async ({ videoPath, meta }) => {
    throw new Error('X is not wired up yet')
  }
}
