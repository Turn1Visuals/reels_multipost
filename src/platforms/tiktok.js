const { shell } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const credentials = require('./credentials')
const tokens = require('../tokens')

const SCOPES = 'user.info.basic,video.upload'
// Fixed port: TikTok requires the exact redirect URI (incl. port) to be registered in the developer portal
const PORT = 8712
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  const data = await res.json()
  if (data.error) throw new Error('TikTok auth failed: ' + (data.error_description || data.error))
  data.obtained_at = Date.now()
  tokens.save('tiktok', data)
  return data
}

// Opens the browser for TikTok consent; a local server on the registered port catches the redirect
function authorize(creds) {
  return new Promise((resolve, reject) => {
    const verifier = crypto.randomBytes(32).toString('hex')
    // TikTok's PKCE is non-standard: hex-encoded SHA256, not base64url
    const challenge = crypto.createHash('sha256').update(verifier).digest('hex')
    const state = crypto.randomBytes(16).toString('hex')

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.end()
        return
      }
      res.setHeader('Content-Type', 'text/html')
      res.end('<h3>Connected. You can close this tab and return to Reels Multipost.</h3>')
      server.close()

      const code = url.searchParams.get('code')
      if (!code || url.searchParams.get('state') !== state) {
        reject(new Error('TikTok login was cancelled'))
        return
      }
      try {
        resolve(await tokenRequest({
          client_key: creds.clientKey,
          client_secret: creds.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier
        }))
      } catch (err) {
        reject(err)
      }
    })

    server.on('error', (err) => reject(new Error('Could not open port ' + PORT + ': ' + err.message)))
    server.listen(PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_key: creds.clientKey,
        response_type: 'code',
        scope: SCOPES,
        redirect_uri: REDIRECT_URI,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      })
      shell.openExternal('https://www.tiktok.com/v2/auth/authorize/?' + params)
    })
  })
}

async function getAccessToken() {
  const creds = credentials.forPlatform('tiktok')
  if (!creds) throw new Error('Add your TikTok client key and secret in Settings first')
  let saved = tokens.load('tiktok')
  if (!saved || !saved.refresh_token) throw new Error('Connect your TikTok account in Settings first')

  const ageSeconds = (Date.now() - saved.obtained_at) / 1000
  if (ageSeconds > saved.expires_in - 300) {
    saved = await tokenRequest({
      client_key: creds.clientKey,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: saved.refresh_token
    })
  }
  return saved.access_token
}

async function fetchDisplayName(accessToken) {
  const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name', {
    headers: { Authorization: 'Bearer ' + accessToken }
  })
  const data = await res.json()
  if (data.error && data.error.code !== 'ok') throw new Error(data.error.message || data.error.code)
  return data.data.user.display_name
}

async function fetchPublishStatus(accessToken, publishId) {
  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publish_id: publishId })
  })
  const data = await res.json()
  if (data.error && data.error.code !== 'ok') throw new Error(data.error.message || data.error.code)
  return data.data
}

module.exports = {
  id: 'tiktok',
  name: 'TikTok (draft)',
  isConfigured: () => credentials.forPlatform('tiktok') !== null,
  // Runs the browser consent flow if needed, returns the connected account name
  connect: async () => {
    const creds = credentials.forPlatform('tiktok')
    if (!creds) throw new Error('Add your TikTok client key and secret in Settings first')
    const saved = tokens.load('tiktok')
    if (!saved || !saved.refresh_token) await authorize(creds)
    return { account: await fetchDisplayName(await getAccessToken()) }
  },
  // Passive check — never opens the browser
  getConnection: async () => {
    const creds = credentials.forPlatform('tiktok')
    const saved = tokens.load('tiktok')
    if (!creds || !saved || !saved.refresh_token) return { connected: false }
    try {
      return { connected: true, account: await fetchDisplayName(await getAccessToken()) }
    } catch (err) {
      return { connected: false }
    }
  },
  // Inbox (draft) upload: the video lands in the TikTok app inbox, caption/title are added there
  post: async ({ videoPath }) => {
    const accessToken = await getAccessToken()
    const buffer = fs.readFileSync(videoPath)
    const mimeType = { '.mov': 'video/quicktime', '.webm': 'video/webm' }[path.extname(videoPath).toLowerCase()] || 'video/mp4'

    // Single chunk up to TikTok's 64MB limit; larger files go in 32MB chunks, remainder merged into the last
    const chunkSize = buffer.length <= 64 * 1024 * 1024 ? buffer.length : 32 * 1024 * 1024
    const totalChunks = Math.floor(buffer.length / chunkSize) || 1

    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: buffer.length,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks
        }
      })
    })
    const init = await initRes.json()
    if (init.error && init.error.code !== 'ok') throw new Error('TikTok init failed: ' + (init.error.message || init.error.code))

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize
      const end = i === totalChunks - 1 ? buffer.length : start + chunkSize
      const uploadRes = await fetch(init.data.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': mimeType,
          'Content-Range': `bytes ${start}-${end - 1}/${buffer.length}`
        },
        body: buffer.subarray(start, end)
      })
      if (!uploadRes.ok) throw new Error('TikTok upload failed: HTTP ' + uploadRes.status)
    }

    const result = { publishId: init.data.publish_id }
    for (let attempt = 0; attempt < 15; attempt++) {
      const status = await fetchPublishStatus(accessToken, init.data.publish_id)
      if (status.status === 'SEND_TO_USER_INBOX') return result
      if (status.status === 'FAILED') throw new Error('TikTok rejected the video: ' + (status.fail_reason || 'unknown reason'))
      await new Promise((r) => setTimeout(r, 2000))
    }
    result.warning = 'upload accepted but still processing — check your TikTok inbox in a bit'
    return result
  }
}
