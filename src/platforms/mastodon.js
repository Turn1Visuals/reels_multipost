const fs = require('fs')
const path = require('path')
const credentials = require('./credentials')

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Resolves the instance base URL (https://host, no trailing slash) and access token
function config() {
  const creds = credentials.forPlatform('mastodon')
  if (!creds) throw new Error('Add your Mastodon instance URL and access token in Settings first')
  let base = creds.instance.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) base = 'https://' + base
  return { base, token: creds.token }
}

async function readJson(res, label) {
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch (err) {
    throw new Error(`Mastodon ${label} returned ${res.status}: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    throw new Error(`Mastodon ${label} failed (${res.status}): ${data.error || JSON.stringify(data)}`)
  }
  return data
}

async function verifyCredentials(base, token) {
  const res = await fetch(base + '/api/v1/accounts/verify_credentials', {
    headers: { Authorization: 'Bearer ' + token }
  })
  const account = await readJson(res, 'account lookup')
  const host = new URL(base).host
  return { username: account.username, account: '@' + account.username + '@' + host }
}

module.exports = {
  id: 'mastodon',
  name: 'Mastodon',
  isConfigured: () => credentials.forPlatform('mastodon') !== null,
  // No browser flow — connecting just verifies the token against the instance
  connect: async () => {
    const { base, token } = config()
    const info = await verifyCredentials(base, token)
    return { account: info.account }
  },
  getConnection: async () => {
    if (!credentials.forPlatform('mastodon')) return { connected: false }
    try {
      const { base, token } = config()
      const info = await verifyCredentials(base, token)
      return { connected: true, account: info.account }
    } catch (err) {
      return { connected: false }
    }
  },
  // Mastodon accepts a direct file upload (no public URL needed). Video is processed
  // asynchronously, so the media id is polled until the instance finishes with it.
  post: async ({ videoPath, meta, onProgress = () => {} }) => {
    const { base, token } = config()
    const buffer = fs.readFileSync(videoPath)
    const ext = path.extname(videoPath).toLowerCase()
    const mime = MIME_BY_EXT[ext] || 'video/mp4'

    onProgress('uploading…')
    const form = new FormData()
    form.append('file', new Blob([buffer], { type: mime }), 'video' + ext)
    // Mastodon accepts a custom video thumbnail on upload (since v3.2.0)
    if (meta.thumbnailDataUrl) {
      const thumb = Buffer.from(meta.thumbnailDataUrl.split(',')[1], 'base64')
      form.append('thumbnail', new Blob([thumb], { type: 'image/jpeg' }), 'thumbnail.jpg')
    }
    const uploadRes = await fetch(base + '/api/v2/media', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form
    })
    const media = await readJson(uploadRes, 'media upload')

    // 202 means the instance is still processing; poll until GET returns 200 (ready)
    if (uploadRes.status === 202) {
      onProgress('processing…')
      let ready = false
      for (let attempt = 0; attempt < 60; attempt++) {
        await sleep(3000)
        const check = await fetch(base + '/api/v1/media/' + media.id, {
          headers: { Authorization: 'Bearer ' + token }
        })
        if (check.status === 200) {
          ready = true
          break
        }
        if (check.status !== 206) throw new Error('Mastodon media processing failed (' + check.status + ')')
      }
      if (!ready) throw new Error('Mastodon media processing timed out')
    }

    onProgress('publishing…')
    const text = [meta.title, meta.caption, meta.hashtags].filter(Boolean).join('\n\n')
    const statusRes = await fetch(base + '/api/v1/statuses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: text, media_ids: [media.id] })
    })
    const status = await readJson(statusRes, 'post')

    return { statusId: status.id, url: status.url }
  }
}
