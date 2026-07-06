const { google } = require('googleapis')
const { shell } = require('electron')
const http = require('http')
const fs = require('fs')
const { Readable } = require('stream')
const credentials = require('./credentials')
const tokens = require('../tokens')

// Full scope: upload + playlist management
const SCOPES = ['https://www.googleapis.com/auth/youtube']

// Opens the browser for Google consent; a temporary local server catches the redirect
function authorizeNew(creds) {
  return new Promise((resolve, reject) => {
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
      if (!code) {
        reject(new Error('Google login was cancelled'))
        return
      }
      try {
        const { tokens: newTokens } = await oauth2.getToken(code)
        tokens.save('youtube', newTokens)
        oauth2.setCredentials(newTokens)
        resolve(oauth2)
      } catch (err) {
        reject(err)
      }
    })

    let oauth2
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}/callback`
      oauth2 = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri)
      const authUrl = oauth2.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES
      })
      shell.openExternal(authUrl)
    })
  })
}

async function getAuthedClient() {
  const creds = credentials.forPlatform('youtube')
  if (!creds) throw new Error('Add your YouTube client ID and secret in Settings first')

  const saved = tokens.load('youtube')
  if (saved && saved.refresh_token) {
    const oauth2 = new google.auth.OAuth2(creds.clientId, creds.clientSecret)
    oauth2.setCredentials(saved)
    oauth2.on('tokens', (t) => tokens.save('youtube', Object.assign({}, saved, t)))
    return oauth2
  }
  return authorizeNew(creds)
}

module.exports = {
  id: 'youtube',
  name: 'YouTube',
  isConfigured: () => credentials.forPlatform('youtube') !== null,
  // Runs the browser consent flow if needed, returns the connected channel name
  connect: async () => {
    const auth = await getAuthedClient()
    const youtube = google.youtube({ version: 'v3', auth })
    const res = await youtube.channels.list({ part: ['snippet'], mine: true })
    return { channel: res.data.items[0] ? res.data.items[0].snippet.title : 'unknown channel' }
  },
  // Passive check — never opens the browser
  getConnection: async () => {
    const creds = credentials.forPlatform('youtube')
    const saved = tokens.load('youtube')
    if (!creds || !saved || !saved.refresh_token) return { connected: false }
    try {
      const auth = await getAuthedClient()
      const youtube = google.youtube({ version: 'v3', auth })
      const res = await youtube.channels.list({ part: ['snippet'], mine: true })
      return { connected: true, channel: res.data.items[0] ? res.data.items[0].snippet.title : 'unknown channel' }
    } catch (err) {
      return { connected: false }
    }
  },
  // Only lists when already logged in — must not pop the consent browser on app start
  listPlaylists: async () => {
    const creds = credentials.forPlatform('youtube')
    const saved = tokens.load('youtube')
    if (!creds || !saved || !saved.refresh_token) return []
    try {
      const auth = await getAuthedClient()
      const youtube = google.youtube({ version: 'v3', auth })
      const res = await youtube.playlists.list({ part: ['snippet'], mine: true, maxResults: 50 })
      return res.data.items.map((p) => ({ id: p.id, title: p.snippet.title }))
    } catch (err) {
      return []
    }
  },
  post: async ({ videoPath, meta }) => {
    const auth = await getAuthedClient()
    const youtube = google.youtube({ version: 'v3', auth })

    const description = [meta.caption, meta.hashtags].filter(Boolean).join('\n\n')
    const snippet = {
      title: meta.title || 'Untitled',
      description
    }
    if (meta.youtubeTags) snippet.tags = meta.youtubeTags.split(',').map((t) => t.trim()).filter(Boolean)
    if (meta.youtubeCategoryId) snippet.categoryId = meta.youtubeCategoryId

    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet,
        status: {
          privacyStatus: meta.youtubePrivacy || 'public',
          selfDeclaredMadeForKids: false
        }
      },
      media: { body: fs.createReadStream(videoPath) }
    })

    const result = { videoId: res.data.id, url: 'https://youtu.be/' + res.data.id }

    const warnings = []

    if (meta.thumbnailDataUrl) {
      try {
        const buffer = Buffer.from(meta.thumbnailDataUrl.split(',')[1], 'base64')
        await youtube.thumbnails.set({
          videoId: res.data.id,
          media: { mimeType: 'image/jpeg', body: Readable.from(buffer) }
        })
      } catch (err) {
        warnings.push('thumbnail failed: ' + err.message)
      }
    }

    if (meta.youtubePlaylistId) {
      try {
        await youtube.playlistItems.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              playlistId: meta.youtubePlaylistId,
              resourceId: { kind: 'youtube#video', videoId: res.data.id }
            }
          }
        })
      } catch (err) {
        warnings.push('playlist add failed: ' + err.message)
      }
    }

    if (warnings.length > 0) result.warning = 'video posted, but ' + warnings.join('; ')
    return result
  }
}
