const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')

const SRC_INDEX = path.resolve(__dirname, '..', 'src', 'index.html')

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Meruem',
    backgroundColor: '#1A1F28',
    webPreferences: {
      // Keep Node out of the page so RequireJS owns `require`.
      // Preload still has Node and installs window.appshell.
      nodeIntegration: false,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // HTML menus (not native CEF menus)
  const url =
    'file:///' +
    SRC_INDEX.replace(/\\/g, '/') +
    '?hasNativeMenus=false'

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, validatedURL) => {
    console.error('[Meruem] did-fail-load', code, desc, validatedURL)
  })
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error('[Meruem:console]', message, sourceId + ':' + line)
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      mainWindow.webContents
        .executeJavaScript(
          `({
            title: document.title,
            hasAppshell: !!(window.appshell && window.appshell.fs),
            hasBrackets: !!window.brackets,
            inBrowser: window.brackets && window.brackets.inBrowser,
            appTitle: window.brackets && window.brackets.config && window.brackets.config.app_title,
            hasSidebar: !!document.getElementById('sidebar'),
            hasEditor: !!document.getElementById('editor-holder'),
            hasMeruemAgentPanel: !!document.getElementById('meruem-agent-panel'),
            hasMeruemAgentCmd: !!(window.brackets && brackets.getModule && (function () {
              try {
                return !!brackets.getModule('command/CommandManager').get('meruem.agent.togglePanel');
              } catch (e) { return false; }
            })()),
            bodyText: (document.body && document.body.innerText || '').slice(0, 200)
          })`
        )
        .then((info) => console.log('[Meruem] page probe', info))
        .catch((err) => console.error('[Meruem] probe failed', err))
    }, 10000)
  })

  mainWindow.loadURL(url)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('appshell:showOpenDialog', async (_e, opts) => {
  const properties = []
  if (opts.chooseDirectory) {
    properties.push('openDirectory')
  } else {
    properties.push('openFile')
  }
  if (opts.allowMultipleSelection) properties.push('multiSelections')

  const filters =
    opts.fileTypes && opts.fileTypes.length
      ? [{ name: 'Files', extensions: opts.fileTypes }]
      : undefined

  return dialog.showOpenDialog(mainWindow, {
    title: opts.title,
    defaultPath: opts.initialPath || undefined,
    properties,
    filters
  })
})

ipcMain.handle('appshell:showSaveDialog', async (_e, opts) => {
  return dialog.showSaveDialog(mainWindow, {
    title: opts.title,
    defaultPath: path.join(opts.initialPath || '', opts.proposedNewFilename || '')
  })
})

ipcMain.on('appshell:showDevTools', (event) => {
  event.sender.openDevTools({ mode: 'detach' })
})

ipcMain.on('appshell:quit', () => {
  app.quit()
})
