const { app } = require('electron')
const { spawn, spawnSync } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')
const settings = require('./settings')

// Serves a single local file over a temporary public tunnel so Instagram's
// servers can fetch the video during publishing. Uses ngrok when an authtoken
// is configured in settings, with Cloudflare quick tunnels as fallback.
const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
const NGROK_ZIP_URL = 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip'

function binaryPath() {
  return path.join(app.getPath('userData'), 'cloudflared.exe')
}

async function ensureBinary() {
  const file = binaryPath()
  if (fs.existsSync(file)) return file
  const res = await fetch(CLOUDFLARED_URL)
  if (!res.ok) throw new Error('cloudflared download failed: HTTP ' + res.status)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}

function ngrokCreds() {
  const section = settings.load().ngrok || {}
  if (section.authtoken) return section
  // no token in settings, but an agent already authenticated on this machine works too
  const onPath = spawnSync('where', ['ngrok'], { windowsHide: true })
  return onPath.status === 0 ? section : null
}

// Prefer an ngrok already on PATH; otherwise download and unzip one into userData
async function ensureNgrok() {
  const onPath = spawnSync('where', ['ngrok'], { windowsHide: true })
  if (onPath.status === 0) return 'ngrok'

  const file = path.join(app.getPath('userData'), 'ngrok.exe')
  if (fs.existsSync(file)) return file

  const zipFile = path.join(app.getPath('userData'), 'ngrok.zip')
  const res = await fetch(NGROK_ZIP_URL)
  if (!res.ok) throw new Error('ngrok download failed: HTTP ' + res.status)
  fs.writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()))
  const unzip = spawnSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Force -Path "${zipFile}" -DestinationPath "${app.getPath('userData')}"`
  ], { windowsHide: true })
  fs.unlinkSync(zipFile)
  if (!fs.existsSync(file)) throw new Error('ngrok unzip failed: ' + unzip.stderr)
  return file
}

function startNgrok(binary, port, creds) {
  return new Promise((resolve, reject) => {
    const args = ['http', String(port), '--log=stdout', '--log-format=logfmt']
    if (creds.domain) args.push('--domain', creds.domain)
    // explicit flag so a token from settings always beats the agent's own config file
    if (creds.authtoken) args.push('--authtoken', creds.authtoken)
    const child = spawn(binary, args, { windowsHide: true })
    let output = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('ngrok did not produce a tunnel URL in time:\n' + output.slice(-500)))
    }, 20000)
    const onData = (data) => {
      output += data.toString()
      const match = output.match(/url=(https:\/\/[^\s]+)/)
      if (match) {
        clearTimeout(timeout)
        resolve({ url: match[1], kill: () => child.kill() })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error('ngrok failed to start: ' + err.message))
    })
    child.on('exit', () => {
      clearTimeout(timeout)
      reject(new Error('ngrok exited: ' + output.slice(-300)))
    })
  })
}

const mimeTypes = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }

function startFileServer(filePath, urlPath) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (new URL(req.url, 'http://localhost').pathname !== urlPath) {
        res.statusCode = 404
        res.end()
        return
      }
      const stat = fs.statSync(filePath)
      res.setHeader('Content-Type', mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream')
      res.setHeader('Accept-Ranges', 'bytes')
      const range = req.headers.range && req.headers.range.match(/bytes=(\d+)-(\d*)/)
      if (range) {
        const start = parseInt(range[1], 10)
        const end = range[2] ? parseInt(range[2], 10) : stat.size - 1
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        res.setHeader('Content-Length', end - start + 1)
        fs.createReadStream(filePath, { start, end }).pipe(res)
      } else {
        res.setHeader('Content-Length', stat.size)
        fs.createReadStream(filePath).pipe(res)
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function startTunnel(binary, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['tunnel', '--url', 'http://127.0.0.1:' + port, '--no-autoupdate'], {
      windowsHide: true
    })
    let output = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('cloudflared did not produce a tunnel URL in time:\n' + output.slice(-500)))
    }, 30000)
    const onData = (data) => {
      output += data.toString()
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match) {
        clearTimeout(timeout)
        resolve({ url: match[0], kill: () => child.kill() })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error('cloudflared failed to start: ' + err.message))
    })
    child.on('exit', () => {
      clearTimeout(timeout)
      reject(new Error('cloudflared exited: ' + output.slice(-300)))
    })
  })
}

// The free quick-tunnel service occasionally 500s — retry a few times before giving up
async function startTunnelWithRetries(binary, port, attempts = 4) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await startTunnel(binary, port)
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
  throw lastError
}

// Returns { url, close } — url is the public address of the file, close tears everything down
async function serveFile(filePath) {
  const urlPath = '/video' + (path.extname(filePath).toLowerCase() || '.mp4')
  const server = await startFileServer(filePath, urlPath)
  const port = server.address().port

  const ngrok = ngrokCreds()
  if (ngrok) {
    try {
      const tunnel = await startNgrok(await ensureNgrok(), port, ngrok)
      return { url: tunnel.url + urlPath, close: () => { tunnel.kill(); server.close() } }
    } catch (err) {
      // fall through to cloudflared
    }
  }

  try {
    const binary = await ensureBinary()
    const tunnel = await startTunnelWithRetries(binary, port)
    return { url: tunnel.url + urlPath, close: () => { tunnel.kill(); server.close() } }
  } catch (err) {
    server.close()
    throw err
  }
}

module.exports = { serveFile }
