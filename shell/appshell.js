/**
 * Meruem Electron appshell — Brackets-compatible fs/app bridge.
 * Injected into the renderer with nodeIntegration enabled.
 */
(function () {
  'use strict'

  const fs = require('fs')
  const path = require('path')
  const { shell, ipcRenderer } = require('electron')
  const os = require('os')

  const appshell = (typeof window.appshell !== 'undefined' && window.appshell) || {}
  appshell.fs = appshell.fs || {}
  appshell.app = appshell.app || {}

  // Error codes — must match adobe/brackets-shell appshell_extensions.js
  appshell.fs.NO_ERROR = 0
  appshell.fs.ERR_UNKNOWN = 1
  appshell.fs.ERR_INVALID_PARAMS = 2
  appshell.fs.ERR_NOT_FOUND = 3
  appshell.fs.ERR_CANT_READ = 4
  appshell.fs.ERR_UNSUPPORTED_ENCODING = 5
  appshell.fs.ERR_CANT_WRITE = 6
  appshell.fs.ERR_OUT_OF_SPACE = 7
  appshell.fs.ERR_NOT_FILE = 8
  appshell.fs.ERR_NOT_DIRECTORY = 9
  appshell.fs.ERR_FILE_EXISTS = 10
  appshell.fs.ERR_BROWSER_NOT_INSTALLED = 11
  appshell.fs.ERR_ENCODE_FILE_FAILED = 18
  appshell.fs.ERR_DECODE_FILE_FAILED = 19
  appshell.fs.ERR_UNSUPPORTED_UTF16_ENCODING = 20

  appshell.app.NO_ERROR = 0
  appshell.app.ERR_CL_TOOLS_CANCELLED = 12
  appshell.app.ERR_CL_TOOLS_RMFAILED = 13
  appshell.app.ERR_CL_TOOLS_MKDIRFAILED = 14
  appshell.app.ERR_CL_TOOLS_SYMLINKFAILED = 15
  appshell.app.ERR_CL_TOOLS_SERVFAILED = 16
  appshell.app.ERR_CL_TOOLS_NOTSUPPORTED = 17
  appshell.app.ERR_NODE_NOT_YET_STARTED = -1
  appshell.app.ERR_NODE_PORT_NOT_YET_SET = -2
  appshell.app.ERR_NODE_FAILED = -3

  function mapFsError(err) {
    if (!err) return appshell.fs.NO_ERROR
    if (err.code === 'ENOENT') return appshell.fs.ERR_NOT_FOUND
    if (err.code === 'EEXIST') return appshell.fs.ERR_FILE_EXISTS
    if (err.code === 'EACCES' || err.code === 'EPERM') return appshell.fs.ERR_CANT_READ
    if (err.code === 'ENOSPC') return appshell.fs.ERR_OUT_OF_SPACE
    return appshell.fs.ERR_UNKNOWN
  }

  function asyncify(fn) {
    return function () {
      const args = Array.prototype.slice.call(arguments)
      const callback = typeof args[args.length - 1] === 'function' ? args.pop() : function () {}
      setTimeout(function () {
        try {
          fn.apply(null, args.concat([callback]))
        } catch (e) {
          callback(mapFsError(e))
        }
      }, 0)
    }
  }

  appshell.fs.stat = asyncify(function (filePath, callback) {
    fs.stat(filePath, function (err, st) {
      if (err) return callback(mapFsError(err))
      callback(appshell.fs.NO_ERROR, {
        isFile: function () {
          return st.isFile()
        },
        isDirectory: function () {
          return st.isDirectory()
        },
        mtime: st.mtime,
        size: st.size,
        realPath: null
      })
    })
  })

  appshell.fs.readdir = asyncify(function (dirPath, callback) {
    fs.readdir(dirPath, function (err, files) {
      if (err) return callback(mapFsError(err))
      callback(
        appshell.fs.NO_ERROR,
        files.filter(function (f) {
          return f !== '.' && f !== '..'
        })
      )
    })
  })

  appshell.fs.makedir = asyncify(function (dirPath, mode, callback) {
    if (typeof mode === 'function') {
      callback = mode
      mode = 0o777
    }
    fs.mkdir(dirPath, { recursive: false, mode: mode }, function (err) {
      callback(mapFsError(err))
    })
  })

  appshell.fs.rename = asyncify(function (oldPath, newPath, callback) {
    fs.rename(oldPath, newPath, function (err) {
      callback(mapFsError(err))
    })
  })

  appshell.fs.readFile = asyncify(function (filePath, encoding, callback) {
    const enc = encoding || 'utf8'
    fs.readFile(filePath, enc === 'utf8' ? 'utf8' : null, function (err, data) {
      if (err) return callback(mapFsError(err))
      if (enc !== 'utf8' && Buffer.isBuffer(data)) {
        callback(appshell.fs.NO_ERROR, data.toString('utf8'), enc, false)
      } else {
        callback(appshell.fs.NO_ERROR, data, enc, false)
      }
    })
  })

  appshell.fs.writeFile = asyncify(function (filePath, data, encoding, preserveBOM, callback) {
    if (typeof preserveBOM === 'function') {
      callback = preserveBOM
      preserveBOM = false
    }
    fs.writeFile(filePath, data, encoding || 'utf8', function (err) {
      callback(mapFsError(err))
    })
  })

  appshell.fs.unlink = asyncify(function (filePath, callback) {
    fs.unlink(filePath, function (err) {
      if (err && err.code === 'EISDIR') {
        return fs.rmdir(filePath, function (e2) {
          callback(mapFsError(e2))
        })
      }
      callback(mapFsError(err))
    })
  })

  appshell.fs.moveToTrash = asyncify(function (filePath, callback) {
    shell
      .trashItem(filePath)
      .then(function () {
        callback(appshell.fs.NO_ERROR)
      })
      .catch(function (err) {
        callback(mapFsError(err))
      })
  })

  appshell.fs.isNetworkDrive = asyncify(function (_filePath, callback) {
    callback(appshell.fs.NO_ERROR, false)
  })

  appshell.fs.showOpenDialog = function (
    allowMultipleSelection,
    chooseDirectory,
    title,
    initialPath,
    fileTypes,
    callback
  ) {
    ipcRenderer
      .invoke('appshell:showOpenDialog', {
        allowMultipleSelection: !!allowMultipleSelection,
        chooseDirectory: !!chooseDirectory,
        title: title || 'Open',
        initialPath: initialPath || '',
        fileTypes: fileTypes || []
      })
      .then(function (result) {
        if (result.canceled) return callback(appshell.fs.NO_ERROR, [])
        callback(appshell.fs.NO_ERROR, result.filePaths || [])
      })
      .catch(function () {
        callback(appshell.fs.ERR_UNKNOWN)
      })
  }

  appshell.fs.showSaveDialog = function (title, initialPath, proposedNewFilename, callback) {
    ipcRenderer
      .invoke('appshell:showSaveDialog', {
        title: title || 'Save As',
        initialPath: initialPath || '',
        proposedNewFilename: proposedNewFilename || ''
      })
      .then(function (result) {
        if (result.canceled) return callback(appshell.fs.NO_ERROR, '')
        callback(appshell.fs.NO_ERROR, result.filePath || '')
      })
      .catch(function () {
        callback(appshell.fs.ERR_UNKNOWN)
      })
  }

  const startTime = Date.now()
  const supportDir = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Meruem'
  )

  try {
    fs.mkdirSync(supportDir, { recursive: true })
    fs.mkdirSync(path.join(supportDir, 'extensions', 'user'), { recursive: true })
  } catch (_e) {
    /* ignore */
  }

  appshell.app.language = (navigator.language || 'en').replace('-', '_')
  appshell.app.getElapsedMilliseconds = function () {
    return Date.now() - startTime
  }
  appshell.app.getApplicationSupportDirectory = function () {
    return supportDir.replace(/\\/g, '/')
  }
  appshell.app.getUserDocumentsDirectory = function () {
    return path.join(os.homedir(), 'Documents').replace(/\\/g, '/')
  }
  appshell.app.showDeveloperTools = function () {
    ipcRenderer.send('appshell:showDevTools')
  }
  appshell.app.openURLInDefaultBrowser = function (url) {
    shell.openExternal(url)
  }
  appshell.app.getNodeState = function (callback) {
    // Node domains not wired yet — report not started
    callback(appshell.app.ERR_NODE_NOT_YET_STARTED, -1)
  }
  appshell.app.quit = function () {
    ipcRenderer.send('appshell:quit')
  }
  appshell.app.abortQuit = function () {}
  appshell.app.getPendingFilesToOpen = function (callback) {
    callback(appshell.fs.NO_ERROR, [], '')
  }
  appshell.app.getDroppedFiles = function (callback) {
    callback(appshell.fs.NO_ERROR, [])
  }
  appshell.app.getRemoteDebuggingPort = function (callback) {
    // 0 = remote debugging disabled (no infobar)
    if (typeof callback === 'function') callback(appshell.fs.NO_ERROR, 0)
  }
  appshell.app.openLiveBrowser = function (_url, _enableRemote, callback) {
    if (typeof callback === 'function') callback(appshell.fs.ERR_BROWSER_NOT_INSTALLED)
  }
  appshell.app.closeLiveBrowser = function (callback) {
    if (typeof callback === 'function') callback(appshell.fs.NO_ERROR)
  }
  appshell.app.getSystemDefaultApp = function (_types, callback) {
    if (typeof callback === 'function') callback(appshell.fs.NO_ERROR, '')
  }
  appshell.app.installCommandLine = function (callback) {
    if (typeof callback === 'function') callback(appshell.app.ERR_CL_TOOLS_NOTSUPPORTED)
  }
  appshell.app.getMachineHash = function (callback) {
    if (typeof callback === 'function') callback(appshell.fs.NO_ERROR, 'meruem-dev')
  }
  appshell.app.showOSFolder = function (dirPath, callback) {
    shell.showItemInFolder(dirPath)
    if (callback) callback(appshell.fs.NO_ERROR)
  }
  appshell.app.showExtensionsFolder = function (_str, callback) {
    const ext = path.join(supportDir, 'extensions', 'user')
    shell.openPath(ext)
    if (callback) callback(appshell.fs.NO_ERROR)
  }
  // Menu stubs — HTML menus still work when nativeMenus is false
  ;[
    'addMenu',
    'addMenuItem',
    'removeMenu',
    'removeMenuItem',
    'setMenuItemState',
    'setMenuTitle',
    'setMenuItemShortcut'
  ].forEach(function (name) {
    appshell.app[name] = function () {
      const cb = arguments[arguments.length - 1]
      if (typeof cb === 'function') cb(appshell.fs.NO_ERROR)
    }
  })

  window.appshell = appshell
  window.brackets = appshell
})()
