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

let appliedFields = {}
let presetsData = { lastSelected: '', presets: {} }

// Everything a preset covers: details fields + all per-platform option fields.
// New fields and platform panels are picked up automatically as long as they have an id.
function formFields() {
  return document.querySelectorAll('#title, #caption, #hashtags, .platform-options input, .platform-options select')
}

function captureForm() {
  const fields = {}
  for (const el of formFields()) {
    if (el.id) fields[el.id] = el.type === 'checkbox' ? el.checked : el.value
  }
  return { fields, platforms: selectedPlatforms() }
}

function applyPreset(name) {
  const preset = presetsData.presets[name]
  if (!preset) return
  appliedFields = preset.fields
  for (const el of formFields()) {
    if (!el.id || preset.fields[el.id] === undefined) continue
    if (el.type === 'checkbox') el.checked = preset.fields[el.id]
    else el.value = preset.fields[el.id]
  }
  for (const checkbox of platformsContainer.querySelectorAll('input[type="checkbox"]')) {
    if (!checkbox.disabled) checkbox.checked = preset.platforms.includes(checkbox.value)
    const panel = document.getElementById(checkbox.value + '-options')
    if (panel) panel.hidden = !checkbox.checked
  }
  updateTiktokModeOptions()
  updatePostButton()
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
  // fall back to the preset's playlist when the list arrives after the preset was applied
  select.value = current || appliedFields['youtube-playlist'] || ''
}

async function loadPlatforms() {
  const platforms = await window.api.getPlatforms()
  const holder = document.getElementById('options-holder')
  // park platform option panels so clearing the list doesn't destroy them
  for (const panel of platformsContainer.querySelectorAll('.platform-options')) {
    holder.appendChild(panel)
  }
  // keep the user's tick state across rebuilds (e.g. after saving settings)
  const previousChecked = {}
  for (const el of platformsContainer.querySelectorAll('input[type="checkbox"]')) {
    previousChecked[el.value] = el.checked
  }
  platformsContainer.innerHTML = ''
  for (const p of platforms) {
    const label = document.createElement('label')
    label.className = 'platform' + (p.configured ? '' : ' unconfigured')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.value = p.id
    checkbox.checked = p.configured && !!previousChecked[p.id]
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

document.getElementById('load-json').addEventListener('click', async () => {
  let data
  try {
    data = await window.api.selectPostJson()
  } catch (err) {
    alert('Could not read JSON: ' + err.message)
    return
  }
  if (!data) return
  for (const el of formFields()) {
    if (!el.id || data[el.id] === undefined) continue
    if (el.type === 'checkbox') el.checked = data[el.id]
    else el.value = data[el.id]
  }
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
      facebookState: document.getElementById('facebook-state').value,
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

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab)
    for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== 'tab-' + tab.dataset.tab
  })
}

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
  wireConnect('tiktok'),
  wireConnect('instagram', refreshMetaConnections),
  wireConnect('facebook', refreshMetaConnections),
  wireConnect('x')
]

// Instagram and Facebook share one Facebook login — connecting either connects both
function refreshMetaConnections() {
  connectionRefreshers[2]()
  connectionRefreshers[3]()
}

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
  renderPresetManager()
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

window.api.onPostProgress(({ platformId, status, error, result, detail }) => {
  const li = document.getElementById('status-' + platformId)
  if (!li) return
  li.className = 'status-' + status
  if (status === 'posting') li.textContent = platformId + ': ' + (detail || 'posting…')
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

const tiktokModeSelect = document.getElementById('tiktok-mode')
const tiktokDirectOptions = document.getElementById('tiktok-direct-options')

function updateTiktokModeOptions() {
  tiktokDirectOptions.hidden = tiktokModeSelect.value !== 'direct'
}

tiktokModeSelect.addEventListener('change', updateTiktokModeOptions)

const presetSelect = document.getElementById('preset-select')
const presetOverlay = document.getElementById('preset-overlay')
const presetSaveButton = document.getElementById('preset-save')
const presetNameInput = document.getElementById('preset-name')

function persistPresets() {
  window.api.savePresets(presetsData)
}

function presetNames() {
  return Object.keys(presetsData.presets).sort((a, b) => a.localeCompare(b))
}

function renderPresetSelect() {
  presetSelect.innerHTML = '<option value="">(no preset)</option>'
  for (const name of presetNames()) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    presetSelect.appendChild(option)
  }
  presetSelect.value = presetsData.lastSelected || ''
}

function clearForm() {
  appliedFields = {}
  for (const el of formFields()) {
    if (el.type === 'checkbox') el.checked = false
    else if (el.tagName === 'SELECT') el.selectedIndex = 0
    else el.value = ''
  }
  for (const checkbox of platformsContainer.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = false
    const panel = document.getElementById(checkbox.value + '-options')
    if (panel) panel.hidden = true
  }
  updateTiktokModeOptions()
  updatePostButton()
}

presetSelect.addEventListener('change', () => {
  presetsData.lastSelected = presetSelect.value
  persistPresets()
  if (presetSelect.value) applyPreset(presetSelect.value)
  else clearForm()
})

function savePresetAs(name) {
  presetsData.presets[name] = captureForm()
  presetsData.lastSelected = name
  persistPresets()
  presetOverlay.hidden = true
  renderPresetSelect()
}

// Preset selected: save updates it in place. No preset: ask for a name.
presetSaveButton.addEventListener('click', () => {
  if (presetSelect.value) {
    savePresetAs(presetSelect.value)
    presetSaveButton.textContent = 'Saved ✓'
    setTimeout(() => { presetSaveButton.textContent = 'Save' }, 1500)
  } else {
    presetNameInput.value = ''
    presetOverlay.hidden = false
    presetNameInput.focus()
  }
})

document.getElementById('preset-cancel').addEventListener('click', () => {
  presetOverlay.hidden = true
})

// Settings: rename presets in place, delete with ✕
function renderPresetManager() {
  const holder = document.getElementById('preset-manager')
  holder.innerHTML = ''
  const names = presetNames()
  if (names.length === 0) {
    holder.innerHTML = '<span class="muted">no presets yet</span>'
    return
  }
  for (const name of names) {
    const row = document.createElement('div')
    row.className = 'preset-row'
    const input = document.createElement('input')
    input.type = 'text'
    input.value = name
    input.addEventListener('change', () => {
      const newName = input.value.trim()
      if (!newName || newName === name || presetsData.presets[newName]) {
        input.value = name
        return
      }
      presetsData.presets[newName] = presetsData.presets[name]
      delete presetsData.presets[name]
      if (presetsData.lastSelected === name) presetsData.lastSelected = newName
      persistPresets()
      renderPresetSelect()
      renderPresetManager()
    })
    const del = document.createElement('button')
    del.textContent = '✕'
    del.title = 'Delete preset'
    del.addEventListener('click', () => {
      delete presetsData.presets[name]
      if (presetsData.lastSelected === name) presetsData.lastSelected = ''
      persistPresets()
      renderPresetSelect()
      renderPresetManager()
    })
    row.appendChild(input)
    row.appendChild(del)
    holder.appendChild(row)
  }
}

document.getElementById('preset-save-confirm').addEventListener('click', () => {
  const name = presetNameInput.value.trim()
  if (!name) return
  savePresetAs(name)
})

async function initPresets() {
  presetsData = await window.api.getPresets()
  if (!presetsData || !presetsData.presets) presetsData = { lastSelected: '', presets: {} }
  renderPresetSelect()
  if (presetsData.lastSelected) applyPreset(presetsData.lastSelected)
}

;(async () => {
  await loadPlatforms()
  await initPresets()
  updateTiktokModeOptions()
  await loadPlaylists()
})()
