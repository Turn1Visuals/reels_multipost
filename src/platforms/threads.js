const threadsAuth = require('./threads-auth')
const tunnel = require('../tunnel')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = {
  id: 'threads',
  name: 'Threads',
  isConfigured: () => threadsAuth.isConfigured(),
  connect: async () => {
    const saved = await threadsAuth.connect()
    const info = await threadsAuth.graphGet('/me', { fields: 'username', access_token: saved.user_token })
    return { account: '@' + info.username }
  },
  // Passive check — never opens the browser
  getConnection: async () => {
    const saved = threadsAuth.loadSaved()
    if (!saved) return { connected: false }
    try {
      const info = await threadsAuth.graphGet('/me', { fields: 'username', access_token: saved.user_token })
      return { connected: true, account: '@' + info.username }
    } catch (err) {
      return { connected: false }
    }
  },
  // Like Instagram, Threads only accepts a public video URL, so the video is served
  // through a temporary tunnel while Threads fetches and processes it.
  // The whole attempt retries once — Threads' video pipeline returns transient errors.
  post: async ({ videoPath, meta, onProgress = () => {} }) => {
    const saved = await threadsAuth.connect()
    try {
      return await publishOnce(saved, videoPath, meta, onProgress)
    } catch (err) {
      onProgress('failed (' + err.message + ') — retrying…')
      await sleep(3000)
      return await publishOnce(saved, videoPath, meta, onProgress)
    }
  }
}

async function publishOnce(saved, videoPath, meta, onProgress) {
  const token = saved.user_token

  onProgress('opening tunnel…')
  const served = await tunnel.serveFile(videoPath)
  try {
    let text = [meta.title, meta.caption, meta.hashtags].filter(Boolean).join('\n\n')
    // Threads allows only one topic per post. A # in the text counts as a competing
    // topic and makes publishing fail, so the # symbols are stripped when a topic tag
    // is used — the words stay as plain text and topic_tag attaches as the chip.
    if (meta.threadsTopic) text = text.replace(/#/g, '')
    const containerParams = {
      media_type: 'VIDEO',
      video_url: served.url,
      text,
      access_token: token
    }
    // topic_tag value must not include the #
    if (meta.threadsTopic) containerParams.topic_tag = meta.threadsTopic.replace(/^#/, '')
    onProgress('Threads is fetching the video…')
    const container = await threadsAuth.graphPost('/' + saved.user_id + '/threads', containerParams)
    onProgress('Threads is processing…')

    // Threads fetches + processes the video; poll until the container is ready
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      const status = await threadsAuth.graphGet('/' + container.id, {
        fields: 'status,error_message',
        access_token: token
      })
      if (status.status === 'FINISHED') {
        ready = true
        break
      }
      if (status.status === 'ERROR' || status.status === 'EXPIRED') {
        throw new Error('Threads could not process the video: ' + (status.error_message || status.status))
      }
      await sleep(3000)
    }
    if (!ready) throw new Error('Threads processing timed out')

    onProgress('publishing…')
    const published = await threadsAuth.graphPost('/' + saved.user_id + '/threads_publish', {
      creation_id: container.id,
      access_token: token
    })

    const result = { mediaId: published.id }
    try {
      const media = await threadsAuth.graphGet('/' + published.id, {
        fields: 'permalink',
        access_token: token
      })
      result.url = media.permalink
    } catch (err) {
      // permalink is nice-to-have only
    }
    return result
  } finally {
    served.close()
  }
}
