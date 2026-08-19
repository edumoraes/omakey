import QtQuick
import Quickshell
import Quickshell.Io
import "SettingsModel.js" as SettingsModel

// Persists what omakey has learned and how often it has spoken. This file is
// the only thing omakey writes outside its own plugin folder.
//
// `learned` and `stats` are separate properties rather than fields of one
// `data` object because QML hands a `property var` to another component as a
// value: `store.data.learned = next` raises "Cannot assign to non-existent
// property". Whole-property assignment is the only form that crosses.
Item {
  id: root

  readonly property string dir: SettingsModel.stateDir(Quickshell.env("HOME"))

  property var learned: ({})
  property var stats: ({})
  // Published by the service for the preferences widget to read. It is derived
  // state, rebuilt on every scan, and a reader that ignores it is unaffected --
  // which is why it does not bump the file version.
  property var categories: []

  function adopt(text) {
    try {
      var parsed = JSON.parse(text)
      if (parsed && parsed.version === 1) {
        root.learned = parsed.learned || {}
        root.stats = parsed.stats || {}
        if (Array.isArray(parsed.categories)) root.categories = parsed.categories
      }
    } catch (error) {
      // A corrupt or absent file is not an error: start from defaults.
    }
  }

  function save() {
    file.setText(JSON.stringify({
      version: 1,
      learned: root.learned,
      stats: root.stats,
      categories: root.categories
    }, null, 2) + "\n")
  }

  // The counters change on every promoted action. Writing synchronously on each
  // one would put disk I/O in the event path, so saves are debounced.
  function scheduleSave() { debounce.restart() }

  FileView {
    id: file
    path: SettingsModel.stateFile(Quickshell.env("HOME"))
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: root.adopt(text())
    onLoadFailed: root.adopt("")
  }

  Timer {
    id: debounce
    interval: 2000
    onTriggered: root.save()
  }

  // FileView will not create a missing directory. The mkdir is asynchronous,
  // which is safe only because the first write is at least a debounce away; if
  // that interval shrinks, save() has to wait on ensureDir.
  Process {
    id: ensureDir
    command: ["mkdir", "-p", root.dir]
  }

  Component.onCompleted: ensureDir.running = true
}
