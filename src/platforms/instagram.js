const metaAuth = require('./meta-auth')

module.exports = {
  id: 'instagram',
  name: 'Instagram',
  isConfigured: () => metaAuth.isConfigured(),
  connect: async () => {
    const saved = await metaAuth.connect()
    if (!saved.igUserId) throw new Error('No Instagram account linked to the Facebook Page')
    const info = await metaAuth.graphGet('/' + saved.igUserId, {
      fields: 'username',
      access_token: saved.page.token
    })
    return { account: '@' + info.username }
  },
  // Passive check — never opens the browser
  getConnection: async () => {
    const saved = metaAuth.loadSaved()
    if (!saved || !saved.igUserId) return { connected: false }
    try {
      const info = await metaAuth.graphGet('/' + saved.igUserId, {
        fields: 'username',
        access_token: saved.page.token
      })
      return { connected: true, account: '@' + info.username }
    } catch (err) {
      return { connected: false }
    }
  },
  post: async ({ videoPath, meta }) => {
    // Instagram's publish API only accepts a public video URL — hosting step not built yet
    throw new Error('Instagram posting needs the video hosting step — not wired up yet')
  }
}
