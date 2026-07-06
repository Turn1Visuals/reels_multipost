const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const platforms = require('./platforms')
const settings = require('./settings')
const prefs = require('./prefs')

let win

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'))
  } catch (err) {
    return {}
  }
}

function createWindow() {
  const state = loadWindowState()
  win = new BrowserWindow({
    width: state.width || 1000,
    height: state.height || 800,
    x: state.x,
    y: state.y,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (state.maximized) win.maximize()
  if (state.fullScreen) win.setFullScreen(true)

  const saveWindowState = () => {
    const bounds = win.getNormalBounds()
    fs.writeFileSync(windowStatePath(), JSON.stringify({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen()
    }))
  }

  // save continuously (debounced), not just on close — a killed process never fires 'close'
  let saveTimer
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveWindowState, 500)
  }
  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(event, scheduleSave)
  }
  win.on('close', saveWindowState)

  win.loadFile(path.join(__dirname, '../public/index.html'))
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Select video',
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('get-youtube-playlists', () => platforms.get('youtube').listPlaylists())

ipcMain.handle('youtube-connect', () => platforms.get('youtube').connect())

ipcMain.handle('youtube-connection', () => platforms.get('youtube').getConnection())

ipcMain.handle('get-platforms', () => {
  return platforms.list().map((p) => ({
    id: p.id,
    name: p.name,
    configured: p.isConfigured()
  }))
})

ipcMain.handle('open-external', (event, url) => shell.openExternal(url))

// Renderer needs raw bytes: drawing a file:// video onto a canvas is blocked, a blob URL is not
ipcMain.handle('read-file', (event, filePath) => fs.readFileSync(filePath))

ipcMain.handle('get-prefs', () => prefs.load())

ipcMain.handle('save-prefs', (event, newPrefs) => {
  prefs.save(newPrefs)
})

ipcMain.handle('get-settings', () => settings.load())

ipcMain.handle('save-settings', (event, newSettings) => {
  settings.save(newSettings)
})

ipcMain.handle('post-video', async (event, payload) => {
  const { platformIds, videoPath, meta } = payload
  const results = {}
  for (const id of platformIds) {
    const platform = platforms.get(id)
    win.webContents.send('post-progress', { platformId: id, status: 'posting' })
    try {
      const result = await platform.post({ videoPath, meta })
      results[id] = { ok: true, ...result }
      win.webContents.send('post-progress', { platformId: id, status: 'done', result: results[id] })
    } catch (err) {
      results[id] = { ok: false, error: err.message }
      win.webContents.send('post-progress', { platformId: id, status: 'error', error: err.message })
    }
  }
  return results
})
