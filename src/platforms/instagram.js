const metaAuth = require('./meta-auth')
const tunnel = require('../tunnel')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  // Instagram only accepts a public video URL, so the video is served through a
  // temporary Cloudflare quick tunnel while Meta fetches and processes it.
  // The whole attempt retries once with a fresh tunnel — the free tunnel service has bad moments.
  post: async ({ videoPath, meta, onProgress = () => {} }) => {
    const saved = await metaAuth.connect()
    if (!saved.igUserId) throw new Error('No Instagram account linked to the Facebook Page')

    try {
      return await publishOnce(saved, videoPath, meta, onProgress)
    } catch (err) {
      onProgress('failed (' + err.message + ') — retrying…')
      await sleep(3000)
      return await publishOnce(saved, videoPath, meta, onProgress)
    }
  }
}

async function publishOnce(saved, videoPath, meta, onProgress) {
  const pageToken = saved.page.token

  onProgress('opening tunnel…')
  const served = await tunnel.serveFile(videoPath)
  try {
    const caption = [meta.title, meta.caption, meta.hashtags].filter(Boolean).join('\n\n')
    const containerParams = {
      media_type: 'REELS',
      video_url: served.url,
      caption,
      access_token: pageToken
    }
    if (meta.thumbnailTimeMs) containerParams.thumb_offset = meta.thumbnailTimeMs
    onProgress('Instagram is fetching the video…')
    const container = await metaAuth.graphPost('/' + saved.igUserId + '/media', containerParams)
    onProgress('Instagram is processing…')

    // Meta fetches + processes the video; poll until the container is ready
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      const status = await metaAuth.graphGet('/' + container.id, {
        fields: 'status_code,status',
        access_token: pageToken
      })
      if (status.status_code === 'FINISHED') {
        ready = true
        break
      }
      if (status.status_code === 'ERROR') {
        throw new Error('Instagram could not process the video: ' + (status.status || 'no detail'))
      }
      await sleep(3000)
    }
    if (!ready) throw new Error('Instagram processing timed out')

    onProgress('publishing…')
    const published = await metaAuth.graphPost('/' + saved.igUserId + '/media_publish', {
      creation_id: container.id,
      access_token: pageToken
    })

    const result = { mediaId: published.id }
    try {
      const media = await metaAuth.graphGet('/' + published.id, {
        fields: 'permalink',
        access_token: pageToken
      })
      result.url = media.permalink
    } catch (err) {
      // permalink is nice-to-have only
    }
    return result
  } finally {
    served.close()
  }
}
