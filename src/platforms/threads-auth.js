const { shell } = require('electron')
const https = require('https')
const crypto = require('crypto')
const selfsigned = require('selfsigned')
const settings = require('../settings')
const tokens = require('../tokens')

// Threads has its own app credentials, login and API host, separate from the
// Facebook/Instagram Meta flow. Its OAuth redirect must be HTTPS, so the local
// callback server runs on a self-signed certificate (a one-time browser warning).
const PORT = 8713
const REDIRECT_URI = `https://localhost:${PORT}/callback`
const AUTH_URL = 'https://threads.net/oauth/authorize'
const GRAPH = 'https://graph.threads.net'
const API = GRAPH + '/v1.0'
const SCOPES = 'threads_basic,threads_content_publish'

function creds() {
  const section = settings.load().threads
  if (!section || !section.appId || !section.appSecret) return null
  return section
}

async function graphGet(path, params) {
  const url = new URL(API + path)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const res = await fetch(url)
  const data = await res.json()
  if (data.error) throw new Error('Threads API: ' + data.error.message)
  return data
}

async function graphPost(path, params) {
  const res = await fetch(API + path, { method: 'POST', body: new URLSearchParams(params) })
  const data = await res.json()
  if (data.error) throw new Error('Threads API: ' + data.error.message)
  return data
}

async function certificate() {
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    days: 3650,
    altNames: [{ type: 2, value: 'localhost' }]
  })
  return { key: pems.private, cert: pems.cert }
}

// Opens the browser for Threads login; a local HTTPS server catches the redirect
async function authorize(c) {
  const cert = await certificate()
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex')

    const server = https.createServer(cert, async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI)
      if (url.pathname !== '/callback') {
        res.end()
        return
      }
      res.setHeader('Content-Type', 'text/html')
      res.end('<h3>Connected. You can close this tab and return to Reels Multipost.</h3>')
      server.close()

      const code = url.searchParams.get('code')
      if (!code || url.searchParams.get('state') !== state) {
        reject(new Error('Threads login was cancelled'))
        return
      }
      try {
        // Short-lived token; the response carries the Threads user id
        const shortRes = await fetch(GRAPH + '/oauth/access_token', {
          method: 'POST',
          body: new URLSearchParams({
            client_id: c.appId,
            client_secret: c.appSecret,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI,
            code
          })
        })
        const short = await shortRes.json()
        if (!short.access_token) {
          throw new Error('Threads token exchange failed: ' + (short.error_message || JSON.stringify(short)))
        }

        // Exchange for a long-lived token (~60 days)
        const longUrl = new URL(GRAPH + '/access_token')
        longUrl.searchParams.set('grant_type', 'th_exchange_token')
        longUrl.searchParams.set('client_secret', c.appSecret)
        longUrl.searchParams.set('access_token', short.access_token)
        const long = await (await fetch(longUrl)).json()
        if (long.error) throw new Error('Threads API: ' + long.error.message)

        const saved = {
          user_token: long.access_token,
          user_id: String(short.user_id),
          obtained_at: Date.now()
        }
        tokens.save('threads', saved)
        resolve(saved)
      } catch (err) {
        reject(err)
      }
    })

    server.on('error', (err) => reject(new Error('Could not open port ' + PORT + ': ' + err.message)))
    server.listen(PORT, '127.0.0.1', () => {
      const params = new URLSearchParams({
        client_id: c.appId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        response_type: 'code',
        state
      })
      shell.openExternal(AUTH_URL + '?' + params)
    })
  })
}

// Opens the browser only when there is no saved token
async function connect() {
  const c = creds()
  if (!c) throw new Error('Add your Threads app ID and secret in Settings first')
  let saved = tokens.load('threads')
  if (!saved || !saved.user_token) saved = await authorize(c)
  return saved
}

function loadSaved() {
  const c = creds()
  const saved = tokens.load('threads')
  if (!c || !saved || !saved.user_token) return null
  return saved
}

module.exports = { connect, loadSaved, graphGet, graphPost, isConfigured: () => creds() !== null }
