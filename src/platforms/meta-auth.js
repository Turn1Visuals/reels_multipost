const { shell } = require('electron')
const http = require('http')
const crypto = require('crypto')
const settings = require('../settings')
const tokens = require('../tokens')

// Instagram and Facebook share one Meta app and one Facebook login; tokens live under 'meta'
const PORT = 8713
const REDIRECT_URI = `http://localhost:${PORT}/callback`
const GRAPH = 'https://graph.facebook.com/v25.0'

function creds() {
  const section = settings.load().meta
  if (!section || !section.appId || !section.appSecret || !section.configId) return null
  return section
}

async function graphGet(path, params) {
  const url = new URL(GRAPH + path)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const res = await fetch(url)
  const data = await res.json()
  if (data.error) throw new Error('Meta API: ' + data.error.message)
  return data
}

async function graphPost(path, params) {
  const body = new URLSearchParams(params)
  const res = await fetch(GRAPH + path, { method: 'POST', body })
  const data = await res.json()
  if (data.error) throw new Error('Meta API: ' + data.error.message)
  return data
}

// Opens the browser for Facebook login; a local server on the registered port catches the redirect
function authorize(c) {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex')

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname !== '/callback') {
        res.end()
        return
      }
      res.setHeader('Content-Type', 'text/html')
      res.end('<h3>Connected. You can close this tab and return to Reels Multipost.</h3>')
      server.close()

      const code = url.searchParams.get('code')
      if (!code || url.searchParams.get('state') !== state) {
        reject(new Error('Facebook login was cancelled'))
        return
      }
      try {
        const shortLived = await graphGet('/oauth/access_token', {
          client_id: c.appId,
          client_secret: c.appSecret,
          redirect_uri: REDIRECT_URI,
          code
        })
        // Long-lived user token (~60 days); page tokens derived from it do not expire
        const longLived = await graphGet('/oauth/access_token', {
          grant_type: 'fb_exchange_token',
          client_id: c.appId,
          client_secret: c.appSecret,
          fb_exchange_token: shortLived.access_token
        })
        const saved = { user_token: longLived.access_token, obtained_at: Date.now() }
        tokens.save('meta', saved)
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
        state,
        response_type: 'code',
        config_id: c.configId
      })
      shell.openExternal('https://www.facebook.com/v25.0/dialog/oauth?' + params)
    })
  })
}

// Ensures login + page/IG discovery; opens the browser only when there is no saved token
async function connect() {
  const c = creds()
  if (!c) throw new Error('Add your Meta app ID, secret and config ID in Settings first')
  let saved = tokens.load('meta')
  if (!saved || !saved.user_token) saved = await authorize(c)

  if (!saved.page) {
    const pages = await graphGet('/me/accounts', {
      access_token: saved.user_token,
      fields: 'id,name,access_token,instagram_business_account'
    })
    if (!pages.data || pages.data.length === 0) throw new Error('No Facebook Page found for this account')
    const page = pages.data[0]
    saved.page = { id: page.id, name: page.name, token: page.access_token }
    saved.igUserId = page.instagram_business_account ? page.instagram_business_account.id : null
    saved.pageCount = pages.data.length
    tokens.save('meta', saved)
  }
  return saved
}

function loadSaved() {
  const c = creds()
  const saved = tokens.load('meta')
  if (!c || !saved || !saved.user_token) return null
  return saved
}

module.exports = { connect, loadSaved, graphGet, graphPost, isConfigured: () => creds() !== null }
