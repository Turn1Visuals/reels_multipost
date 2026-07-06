const fs = require('fs')
const metaAuth = require('./meta-auth')

module.exports = {
  id: 'facebook',
  name: 'Facebook',
  isConfigured: () => metaAuth.isConfigured(),
  connect: async () => {
    const saved = await metaAuth.connect()
    return { account: saved.page.name }
  },
  // Passive check — never opens the browser
  getConnection: async () => {
    const saved = metaAuth.loadSaved()
    if (!saved || !saved.page) return { connected: false }
    try {
      await metaAuth.graphGet('/' + saved.page.id, { fields: 'name', access_token: saved.page.token })
      return { connected: true, account: saved.page.name }
    } catch (err) {
      return { connected: false }
    }
  },
  // Publishes a Reel to the page: start -> binary upload -> finish (+ thumbnail attempt)
  post: async ({ videoPath, meta }) => {
    const saved = await metaAuth.connect()
    const pageToken = saved.page.token
    const buffer = fs.readFileSync(videoPath)

    const start = await metaAuth.graphPost('/' + saved.page.id + '/video_reels', {
      upload_phase: 'start',
      access_token: pageToken
    })

    const uploadRes = await fetch(start.upload_url, {
      method: 'POST',
      headers: {
        Authorization: 'OAuth ' + pageToken,
        offset: '0',
        file_size: String(buffer.length)
      },
      body: buffer
    })
    const upload = await uploadRes.json()
    if (!upload.success) throw new Error('Facebook upload failed: ' + JSON.stringify(upload))

    const description = [meta.caption, meta.hashtags].filter(Boolean).join('\n\n')
    await metaAuth.graphPost('/' + saved.page.id + '/video_reels', {
      upload_phase: 'finish',
      video_id: start.video_id,
      video_state: 'PUBLISHED',
      description,
      access_token: pageToken
    })

    const result = { videoId: start.video_id, url: 'https://www.facebook.com/reel/' + start.video_id }

    // Reels may or may not accept a custom thumbnail — try, warn instead of fail
    if (meta.thumbnailDataUrl) {
      try {
        const imageBuffer = Buffer.from(meta.thumbnailDataUrl.split(',')[1], 'base64')
        const form = new FormData()
        form.append('source', new Blob([imageBuffer], { type: 'image/jpeg' }), 'thumb.jpg')
        form.append('is_preferred', 'true')
        form.append('access_token', pageToken)
        const thumbRes = await fetch('https://graph.facebook.com/v25.0/' + start.video_id + '/thumbnails', {
          method: 'POST',
          body: form
        })
        const thumb = await thumbRes.json()
        if (thumb.error) throw new Error(thumb.error.message)
      } catch (err) {
        result.warning = 'video posted, but thumbnail failed: ' + err.message
      }
    }

    return result
  }
}
