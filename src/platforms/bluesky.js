const fs = require('fs')
const path = require('path')
const credentials = require('./credentials')

// Login goes through the bsky.social entryway (works for all Bluesky-hosted
// accounts, custom domains included); the account's real PDS is read from the
// session and used for the write calls. Video goes through the video service.
const ENTRYWAY = 'https://bsky.social'
const VIDEO_SERVICE = 'https://video.bsky.app'

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function creds() {
  const c = credentials.forPlatform('bluesky')
  if (!c) throw new Error('Add your Bluesky handle and app password in Settings first')
  return c
}

// Bluesky doesn't auto-link #hashtags — each one needs a richtext facet marking its
// byte range (UTF-8 offsets, not string indices, so multibyte text stays correct).
function hashtagFacets(text) {
  const facets = []
  const re = /(^|\s)(#[\p{L}\p{N}_]+)/gu
  let match
  while ((match = re.exec(text)) !== null) {
    const hashtag = match[2]
    const charStart = match.index + match[1].length
    const byteStart = Buffer.byteLength(text.slice(0, charStart), 'utf8')
    facets.push({
      index: { byteStart, byteEnd: byteStart + Buffer.byteLength(hashtag, 'utf8') },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: hashtag.slice(1) }]
    })
  }
  return facets
}

async function xrpc(base, nsid, { method = 'GET', token, query, body, contentType, raw } = {}) {
  let url = base + '/xrpc/' + nsid
  if (query) url += '?' + new URLSearchParams(query)
  const headers = {}
  if (token) headers.Authorization = 'Bearer ' + token
  let payload
  if (body !== undefined) {
    if (raw) {
      payload = body
      if (contentType) headers['Content-Type'] = contentType
    } else {
      payload = JSON.stringify(body)
      headers['Content-Type'] = 'application/json'
    }
  }
  const res = await fetch(url, { method, headers, body: payload })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch (err) {
    throw new Error(`Bluesky ${nsid} returned ${res.status}: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    throw new Error(`Bluesky ${nsid} failed (${res.status}): ${data.message || data.error || JSON.stringify(data)}`)
  }
  return data
}

async function createSession() {
  const c = creds()
  const session = await xrpc(ENTRYWAY, 'com.atproto.server.createSession', {
    method: 'POST',
    body: { identifier: c.handle.replace(/^@/, ''), password: c.appPassword }
  })
  // The account's real PDS lives in the DID doc; fall back to the entryway
  let pds = ENTRYWAY
  const svc = session.didDoc && session.didDoc.service &&
    session.didDoc.service.find((s) => s.id === '#atproto_pds')
  if (svc && svc.serviceEndpoint) pds = svc.serviceEndpoint
  return { did: session.did, handle: session.handle, accessJwt: session.accessJwt, pds }
}

module.exports = {
  id: 'bluesky',
  name: 'Bluesky',
  isConfigured: () => credentials.forPlatform('bluesky') !== null,
  // No browser flow — connecting just logs in with the app password
  connect: async () => {
    const s = await createSession()
    return { account: '@' + s.handle }
  },
  getConnection: async () => {
    if (!credentials.forPlatform('bluesky')) return { connected: false }
    try {
      const s = await createSession()
      return { connected: true, account: '@' + s.handle }
    } catch (err) {
      return { connected: false }
    }
  },
  // Video goes through Bluesky's video service: get a service-auth token, upload
  // the bytes, poll the processing job for the resulting blob, then create the post.
  post: async ({ videoPath, meta, onProgress = () => {} }) => {
    const s = await createSession()
    const buffer = fs.readFileSync(videoPath)
    const ext = path.extname(videoPath).toLowerCase()
    const mime = MIME_BY_EXT[ext] || 'video/mp4'
    const pdsHost = new URL(s.pds).host

    onProgress('preparing upload…')
    const serviceAuth = await xrpc(s.pds, 'com.atproto.server.getServiceAuth', {
      token: s.accessJwt,
      query: {
        aud: 'did:web:' + pdsHost,
        lxm: 'com.atproto.repo.uploadBlob',
        exp: Math.floor(Date.now() / 1000) + 1800
      }
    })
    const videoToken = serviceAuth.token

    onProgress('uploading…')
    const upload = await xrpc(VIDEO_SERVICE, 'app.bsky.video.uploadVideo', {
      method: 'POST',
      token: videoToken,
      query: { did: s.did, name: 'video' + ext },
      body: buffer,
      raw: true,
      contentType: mime
    })

    let blob = upload.blob
    const jobId = upload.jobId
    if (!blob) {
      onProgress('processing…')
      for (let attempt = 0; attempt < 90; attempt++) {
        await sleep(2000)
        const status = await xrpc(VIDEO_SERVICE, 'app.bsky.video.getJobStatus', {
          token: videoToken,
          query: { jobId }
        })
        const job = status.jobStatus || {}
        if (job.blob) {
          blob = job.blob
          break
        }
        if (job.state === 'JOB_STATE_FAILED' || job.error) {
          throw new Error('Bluesky video processing failed: ' + (job.error || job.message || job.state))
        }
      }
      if (!blob) throw new Error('Bluesky video processing timed out')
    }

    onProgress('publishing…')
    const text = [meta.title, meta.caption, meta.hashtags].filter(Boolean).join('\n\n')
    const record = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
      embed: { $type: 'app.bsky.embed.video', video: blob }
    }
    const facets = hashtagFacets(text)
    if (facets.length) record.facets = facets
    const created = await xrpc(s.pds, 'com.atproto.repo.createRecord', {
      method: 'POST',
      token: s.accessJwt,
      body: { repo: s.did, collection: 'app.bsky.feed.post', record }
    })

    const rkey = created.uri.split('/').pop()
    return { uri: created.uri, url: 'https://bsky.app/profile/' + s.handle + '/post/' + rkey }
  }
}
