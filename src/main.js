const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const platforms = require('./platforms')
const settings = require('./settings')

let win

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
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

ipcMain.handle('get-platforms', () => {
  return platforms.list().map((p) => ({
    id: p.id,
    name: p.name,
    configured: p.isConfigured()
  }))
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
