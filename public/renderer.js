let videoPath = null

const selectButton = document.getElementById('select-video')
const videoName = document.getElementById('video-name')
const videoPreview = document.getElementById('video-preview')
const platformsContainer = document.getElementById('platforms')
const postButton = document.getElementById('post')
const statusCard = document.getElementById('status-card')
const statusList = document.getElementById('status-list')

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

selectButton.addEventListener('click', async () => {
  const path = await window.api.selectVideo()
  if (!path) return
  videoPath = path
  videoName.textContent = path.split(/[\\/]/).pop()
  videoName.classList.remove('muted')
  videoPreview.src = 'file:///' + path.replace(/\\/g, '/')
  videoPreview.hidden = false
  updatePostButton()
})

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
      hashtags: document.getElementById('hashtags').value.trim()
    }
  })
  postButton.disabled = false
})

const settingsOverlay = document.getElementById('settings-overlay')

document.getElementById('open-settings').addEventListener('click', async () => {
  const settings = await window.api.getSettings()
  for (const input of settingsOverlay.querySelectorAll('[data-setting]')) {
    const [section, key] = input.dataset.setting.split('.')
    input.value = (settings[section] && settings[section][key]) || ''
  }
  settingsOverlay.hidden = false
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
  }
})

loadPlatforms()
