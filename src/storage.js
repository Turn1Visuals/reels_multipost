const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const settings = require('./settings')

// Temporary public hosting on Backblaze B2 so Instagram can fetch the video.
// Uses an application key scoped to one bucket; the file is deleted after publishing.

function creds() {
  const section = settings.load().b2
  if (!section || !section.keyId || !section.appKey) return null
  return section
}

function isConfigured() {
  return creds() !== null
}

async function b2(url, options, label) {
  const res = await fetch(url, options)
  const data = await res.json()
  if (data.code || data.status >= 400) throw new Error('B2 ' + label + ' failed: ' + (data.message || data.code))
  return data
}

const mimeTypes = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }

// Returns { url, remove } — url is the public address of the file, remove deletes it from the bucket
async function uploadTemp(filePath) {
  const c = creds()
  if (!c) throw new Error('B2 storage is not configured')

  const auth = await b2('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: 'Basic ' + Buffer.from(c.keyId + ':' + c.appKey).toString('base64') }
  }, 'authorize')

  const bucketId = auth.allowed.bucketId
  const bucketName = auth.allowed.bucketName
  if (!bucketId || !bucketName) throw new Error('The B2 application key must be restricted to one bucket')

  const upload = await b2(auth.apiUrl + '/b2api/v2/b2_get_upload_url', {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken },
    body: JSON.stringify({ bucketId })
  }, 'get upload url')

  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const fileName = 'tmp/' + crypto.randomBytes(16).toString('hex') + ext

  const uploaded = await b2(upload.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: upload.authorizationToken,
      'X-Bz-File-Name': fileName,
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'X-Bz-Content-Sha1': crypto.createHash('sha1').update(buffer).digest('hex')
    },
    body: buffer
  }, 'upload')

  return {
    url: auth.downloadUrl + '/file/' + bucketName + '/' + fileName,
    remove: async () => {
      try {
        await b2(auth.apiUrl + '/b2api/v2/b2_delete_file_version', {
          method: 'POST',
          headers: { Authorization: auth.authorizationToken },
          body: JSON.stringify({ fileName: uploaded.fileName, fileId: uploaded.fileId })
        }, 'delete')
      } catch (err) {
        // best effort — a leftover tmp file is harmless and unguessable
      }
    }
  }
}

module.exports = { isConfigured, uploadTemp }
