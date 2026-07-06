const { google } = require('googleapis')
const { shell } = require('electron')
const http = require('http')
const fs = require('fs')
const credentials = require('./credentials')
const tokens = require('../tokens')

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload']

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
  post: async ({ videoPath, meta }) => {
    const auth = await getAuthedClient()
    const youtube = google.youtube({ version: 'v3', auth })

    const description = [meta.caption, meta.hashtags].filter(Boolean).join('\n\n')
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: meta.title || 'Untitled',
          description
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false
        }
      },
      media: { body: fs.createReadStream(videoPath) }
    })

    return { videoId: res.data.id, url: 'https://youtu.be/' + res.data.id }
  }
}
