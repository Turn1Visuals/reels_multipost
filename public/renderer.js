let videoPath = null
let thumbnailDataUrl = null

const selectButton = document.getElementById('select-video')
const videoName = document.getElementById('video-name')
const videoPreview = document.getElementById('video-preview')
const platformsContainer = document.getElementById('platforms')
const postButton = document.getElementById('post')
const statusCard = document.getElementById('status-card')
const statusList = document.getElementById('status-list')

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
  select.value = current
}

async function loadPlatforms() {
  const platforms = await window.api.getPlatforms()
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
  }
  updatePostButton()
}

function selectedPlatforms() {
  return [...platformsContainer.querySelectorAll('input:checked')].map((el) => el.value)
}

function updatePostButton() {
  postButton.disabled = !videoPath || selectedPlatforms().length === 0
}

const thumbRow = document.getElementById('thumb-row')
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
  thumbRow.hidden = false
  clearThumbnail()
  updatePostButton()
})

function clearThumbnail() {
  thumbnailDataUrl = null
  thumbPreview.src = ''
  thumbPreviewWrap.hidden = true
}

document.getElementById('capture-frame').addEventListener('click', () => {
  const canvas = document.createElement('canvas')
  canvas.width = videoPreview.videoWidth
  canvas.height = videoPreview.videoHeight
  canvas.getContext('2d').drawImage(videoPreview, 0, 0)
  thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.9)
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

const youtubeConnectionLabel = document.getElementById('youtube-connection')

async function refreshYoutubeConnection() {
  const info = await window.api.youtubeConnection()
  youtubeConnectionLabel.textContent = info.connected ? 'connected: ' + info.channel : 'not connected'
  youtubeConnectionLabel.className = info.connected ? 'status-done' : 'muted'
}

document.getElementById('youtube-connect').addEventListener('click', async () => {
  youtubeConnectionLabel.textContent = 'waiting for browser login…'
  youtubeConnectionLabel.className = 'muted'
  try {
    const info = await window.api.youtubeConnect()
    youtubeConnectionLabel.textContent = 'connected: ' + info.channel
    youtubeConnectionLabel.className = 'status-done'
    loadPlaylists()
  } catch (err) {
    youtubeConnectionLabel.textContent = 'connection failed'
    youtubeConnectionLabel.className = 'status-error'
  }
})

document.getElementById('open-settings').addEventListener('click', async () => {
  const settings = await window.api.getSettings()
  for (const input of settingsOverlay.querySelectorAll('[data-setting]')) {
    const [section, key] = input.dataset.setting.split('.')
    input.value = (settings[section] && settings[section][key]) || ''
  }
  settingsOverlay.hidden = false
  refreshYoutubeConnection()
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

loadPlaylists()

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

loadPlatforms()
