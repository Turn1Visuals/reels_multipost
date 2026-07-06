let videoPath = null
let thumbnailDataUrl = null
let thumbnailTimeMs = null

const selectButton = document.getElementById('select-video')
const videoName = document.getElementById('video-name')
const videoPreview = document.getElementById('video-preview')
const platformsContainer = document.getElementById('platforms')
const postButton = document.getElementById('post')
const statusCard = document.getElementById('status-card')
const statusList = document.getElementById('status-list')

let savedPrefs = {}

function prefFields() {
  return document.querySelectorAll('.platform-options input, .platform-options select')
}

async function restorePrefs() {
  savedPrefs = await window.api.getPrefs()
  for (const el of prefFields()) {
    if (!el.id || savedPrefs[el.id] === undefined) continue
    if (el.type === 'checkbox') el.checked = savedPrefs[el.id]
    else el.value = savedPrefs[el.id]
  }
  for (const el of prefFields()) {
    el.addEventListener('change', storePrefs)
  }
}

function storePrefs() {
  savedPrefs = {}
  for (const el of prefFields()) {
    if (el.id) savedPrefs[el.id] = el.type === 'checkbox' ? el.checked : el.value
  }
  window.api.savePrefs(savedPrefs)
}

async function loadPlaylists() {
  const select = document.getElementById('youtube-playlist')
  const playlists = await window.api.getYoutubePlaylists()
  const current = select.value
  select.innerHTML = '<option value="">(none)</option>'
  for (const p of playlists) {
    const option = document.createElement('option')
    option.value = p.id
    option.textContent = p.title
    select.appendChild(option)
  }
  // fall back to the remembered playlist when the list arrives after restorePrefs
  select.value = current || savedPrefs['youtube-playlist'] || ''
}

async function loadPlatforms() {
  const platforms = await window.api.getPlatforms()
  const holder = document.getElementById('options-holder')
  // park platform option panels so clearing the list doesn't destroy them
  for (const panel of platformsContainer.querySelectorAll('.platform-options')) {
    holder.appendChild(panel)
  }
  platformsContainer.innerHTML = ''
  for (const p of platforms) {
    const label = document.createElement('label')
    label.className = 'platform' + (p.configured ? '' : ' unconfigured')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.value = p.id
    checkbox.checked = p.configured
    checkbox.disabled = !p.configured
    checkbox.addEventListener('change', updatePostButton)
    label.appendChild(checkbox)
    label.appendChild(document.createTextNode(p.name))
    if (!p.configured) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = 'not configured'
      label.appendChild(badge)
    }
    platformsContainer.appendChild(label)

    const options = document.getElementById(p.id + '-options')
    if (options) {
      platformsContainer.appendChild(options)
      options.hidden = !checkbox.checked
      checkbox.addEventListener('change', () => {
        options.hidden = !checkbox.checked
      })
    }
  }
  updatePostButton()
}

function selectedPlatforms() {
  return [...platformsContainer.querySelectorAll('input:checked')].map((el) => el.value)
}

function updatePostButton() {
  postButton.disabled = !videoPath || selectedPlatforms().length === 0
}

const captureButton = document.getElementById('capture-frame')
const thumbPreviewWrap = document.getElementById('thumb-preview-wrap')
const thumbPreview = document.getElementById('thumb-preview')

selectButton.addEventListener('click', async () => {
  const path = await window.api.selectVideo()
  if (!path) return
  videoPath = path
  videoName.textContent = path.split(/[\\/]/).pop()
  videoName.classList.remove('muted')
  const data = await window.api.readFile(path)
  if (videoPreview.src) URL.revokeObjectURL(videoPreview.src)
  videoPreview.src = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }))
  videoPreview.hidden = false
  captureButton.hidden = false
  clearThumbnail()
  updatePostButton()
})

function clearThumbnail() {
  thumbnailDataUrl = null
  thumbnailTimeMs = null
  thumbPreview.src = ''
  thumbPreviewWrap.hidden = true
}

captureButton.addEventListener('click', () => {
  const canvas = document.createElement('canvas')
  canvas.width = videoPreview.videoWidth
  canvas.height = videoPreview.videoHeight
  canvas.getContext('2d').drawImage(videoPreview, 0, 0)
  thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.9)
  thumbnailTimeMs = Math.round(videoPreview.currentTime * 1000)
  thumbPreview.src = thumbnailDataUrl
  thumbPreviewWrap.hidden = false
})

document.getElementById('remove-thumb').addEventListener('click', clearThumbnail)

postButton.addEventListener('click', async () => {
  const platformIds = selectedPlatforms()
  statusCard.hidden = false
  statusList.innerHTML = ''
  for (const id of platformIds) {
    const li = document.createElement('li')
    li.id = 'status-' + id
    li.textContent = id + ': waiting…'
    statusList.appendChild(li)
  }
  postButton.disabled = true
  await window.api.postVideo({
    platformIds,
    videoPath,
    meta: {
      title: document.getElementById('title').value.trim(),
      caption: document.getElementById('caption').value.trim(),
      hashtags: document.getElementById('hashtags').value.trim(),
      thumbnailDataUrl,
      thumbnailTimeMs,
      tiktokMode: document.getElementById('tiktok-mode').value,
      tiktokPrivacy: document.getElementById('tiktok-privacy').value,
      tiktokDisableComment: document.getElementById('tiktok-disable-comment').checked,
      tiktokDisableDuet: document.getElementById('tiktok-disable-duet').checked,
      tiktokDisableStitch: document.getElementById('tiktok-disable-stitch').checked,
      youtubePlaylistId: document.getElementById('youtube-playlist').value,
      youtubePrivacy: document.getElementById('youtube-privacy').value,
      youtubeTags: document.getElementById('youtube-tags').value.trim(),
      youtubeCategoryId: document.getElementById('youtube-category').value
    }
  })
  postButton.disabled = false
  loadPlaylists()
})

const settingsOverlay = document.getElementById('settings-overlay')

// Wires a connect/disconnect row in settings; returns a function that refreshes the status label
function wireConnect(platformId, onChange) {
  const label = document.getElementById(platformId + '-connection')
  const button = document.getElementById(platformId + '-connect')
  let connected = false

  const render = (info) => {
    connected = info.connected
    button.textContent = connected ? 'Disconnect' : 'Connect account'
    label.textContent = connected ? 'connected: ' + info.account : 'not connected'
    label.className = connected ? 'status-done' : 'muted'
  }

  button.addEventListener('click', async () => {
    if (connected) {
      await window.api.platformDisconnect(platformId)
      render({ connected: false })
      if (onChange) onChange()
      return
    }
    label.textContent = 'waiting for browser login…'
    label.className = 'muted'
    try {
      const info = await window.api.platformConnect(platformId)
      render({ connected: true, account: info.account })
      if (onChange) onChange()
    } catch (err) {
      label.textContent = 'connection failed'
      label.className = 'status-error'
    }
  })

  return async () => render(await window.api.platformConnection(platformId))
}

const connectionRefreshers = [
  wireConnect('youtube', loadPlaylists),
  wireConnect('tiktok')
]

for (const button of document.querySelectorAll('.toggle-credentials')) {
  button.addEventListener('click', () => {
    const box = button.parentElement.querySelector('.credentials')
    box.hidden = !box.hidden
    button.textContent = box.hidden ? 'Show credentials' : 'Hide credentials'
  })
}

document.getElementById('open-settings').addEventListener('click', async () => {
  const settings = await window.api.getSettings()
  for (const input of settingsOverlay.querySelectorAll('[data-setting]')) {
    const [section, key] = input.dataset.setting.split('.')
    input.value = (settings[section] && settings[section][key]) || ''
  }
  for (const box of settingsOverlay.querySelectorAll('.credentials')) box.hidden = true
  for (const button of settingsOverlay.querySelectorAll('.toggle-credentials')) button.textContent = 'Show credentials'
  settingsOverlay.hidden = false
  for (const refresh of connectionRefreshers) refresh()
})

document.getElementById('close-settings').addEventListener('click', () => {
  settingsOverlay.hidden = true
})

document.getElementById('save-settings').addEventListener('click', async () => {
  const settings = {}
  for (const input of settingsOverlay.querySelectorAll('[data-setting]')) {
    const [section, key] = input.dataset.setting.split('.')
    if (!settings[section]) settings[section] = {}
    settings[section][key] = input.value.trim()
  }
  await window.api.saveSettings(settings)
  settingsOverlay.hidden = true
  loadPlatforms()
})

window.api.onPostProgress(({ platformId, status, error, result }) => {
  const li = document.getElementById('status-' + platformId)
  if (!li) return
  li.className = 'status-' + status
  if (status === 'posting') li.textContent = platformId + ': posting…'
  if (status === 'error') li.textContent = platformId + ': ✗ ' + error
  if (status === 'done') {
    li.textContent = platformId + ': ✓ posted '
    if (result && result.url) {
      const link = document.createElement('a')
      link.href = '#'
      link.textContent = result.url
      link.addEventListener('click', (e) => {
        e.preventDefault()
        window.api.openExternal(result.url)
      })
      li.appendChild(link)
    }
    if (result && result.warning) {
      li.appendChild(document.createTextNode(' ⚠ ' + result.warning))
    }
  }
})

;(async () => {
  await loadPlatforms()
  await restorePrefs()
  await loadPlaylists()
})()
