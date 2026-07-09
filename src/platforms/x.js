const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const OAuth = require('oauth-1.0a')
const credentials = require('./credentials')

const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json'
const TWEETS_URL = 'https://api.twitter.com/2/tweets'
const ME_URL = 'https://api.twitter.com/2/users/me'
const CHUNK_SIZE = 5 * 1024 * 1024 // X caps APPEND chunks at 5 MB

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Builds a signer bound to the four OAuth 1.0a credentials from Settings
function signer() {
  const creds = credentials.forPlatform('x')
  if (!creds) throw new Error('Add your X API key, secret and access tokens in Settings first')

  const oauth = OAuth({
    consumer: { key: creds.apiKey, secret: creds.apiSecret },
    signature_method: 'HMAC-SHA1',
    hash_function: (base, key) => crypto.createHmac('sha1', key).update(base).digest('base64')
  })
  const token = { key: creds.accessToken, secret: creds.accessTokenSecret }

  // For form-encoded and query params, `data` is signed; for multipart/JSON bodies pass {}
  return (url, method, data) => oauth.toHeader(oauth.authorize({ url, method, data: data || {} }, token))
}

// INIT / FINALIZE / STATUS speak application/x-www-form-urlencoded; their params are signed
async function uploadCommand(sign, params, method = 'POST') {
  if (method === 'GET') {
    const header = sign(UPLOAD_URL, 'GET', params)
    const res = await fetch(UPLOAD_URL + '?' + new URLSearchParams(params), { headers: header })
    return readJson(res, 'media upload')
  }
  const header = sign(UPLOAD_URL, 'POST', params)
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { ...header, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  })
  return readJson(res, 'media upload')
}

async function readJson(res, label) {
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch (err) {
    throw new Error(`X ${label} returned ${res.status}: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const detail = data.errors ? JSON.stringify(data.errors) : (data.detail || data.title || JSON.stringify(data))
    throw new Error(`X ${label} failed (${res.status}): ${detail}`)
  }
  return data
}

async function uploadVideo(sign, videoPath, onProgress) {
  const buffer = fs.readFileSync(videoPath)
  const mediaType = MIME_BY_EXT[path.extname(videoPath).toLowerCase()] || 'video/mp4'

  onProgress('starting upload…')
  const init = await uploadCommand(sign, {
    command: 'INIT',
    total_bytes: buffer.length,
    media_type: mediaType,
    media_category: 'tweet_video'
  })
  const mediaId = init.media_id_string

  // APPEND is multipart/form-data — the fields are not part of the OAuth signature
  const chunks = Math.ceil(buffer.length / CHUNK_SIZE)
  for (let i = 0; i < chunks; i++) {
    onProgress(`uploading… (${i + 1}/${chunks})`)
    const chunk = buffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
    const form = new FormData()
    form.append('command', 'APPEND')
    form.append('media_id', mediaId)
    form.append('segment_index', String(i))
    form.append('media', new Blob([chunk]), 'chunk')
    const header = sign(UPLOAD_URL, 'POST', {})
    const res = await fetch(UPLOAD_URL, { method: 'POST', headers: header, body: form })
    if (!res.ok) throw new Error(`X media upload APPEND failed (${res.status}): ${await res.text()}`)
  }

  onProgress('processing…')
  const finalize = await uploadCommand(sign, { command: 'FINALIZE', media_id: mediaId })

  // Video is processed asynchronously; poll STATUS until it finishes
  let info = finalize.processing_info
  while (info && (info.state === 'pending' || info.state === 'in_progress')) {
    await sleep((info.check_after_secs || 3) * 1000)
    const status = await uploadCommand(sign, { command: 'STATUS', media_id: mediaId }, 'GET')
    info = status.processing_info
  }
  if (info && info.state === 'failed') {
    const err = info.error || {}
    throw new Error('X could not process the video: ' + (err.message || JSON.stringify(err)))
  }

  return mediaId
}

async function whoami(sign) {
  const header = sign(ME_URL, 'GET', {})
  const res = await fetch(ME_URL, { headers: header })
  const data = await readJson(res, 'account lookup')
  return data.data
}

module.exports = {
  id: 'x',
  name: 'X',
  isConfigured: () => credentials.forPlatform('x') !== null,
  // No browser flow — connecting just verifies the four keys against the account
  connect: async () => {
    const user = await whoami(signer())
    return { account: '@' + user.username }
  },
  getConnection: async () => {
    if (!credentials.forPlatform('x')) return { connected: false }
    try {
      const user = await whoami(signer())
      return { connected: true, account: '@' + user.username }
    } catch (err) {
      return { connected: false }
    }
  },
  post: async ({ videoPath, meta, onProgress = () => {} }) => {
    const sign = signer()
    const mediaId = await uploadVideo(sign, videoPath, onProgress)

    onProgress('publishing…')
    const text = [meta.title, meta.caption, meta.hashtags].filter(Boolean).join('\n\n')
    const header = sign(TWEETS_URL, 'POST', {})
    const res = await fetch(TWEETS_URL, {
      method: 'POST',
      headers: { ...header, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, media: { media_ids: [mediaId] } })
    })
    const data = await readJson(res, 'post')

    return { tweetId: data.data.id, url: 'https://x.com/i/status/' + data.data.id }
  }
}
