import QtQuick
import Quickshell
import Quickshell.Hyprland

// omakey's service half. It owns the units and wires them together; every
// decision it makes lives in a plain .js model beside it, so the logic is
// unit-testable and this file stays I/O and wiring only.
Item {
  id: root

  property var shell: null
  property var manifest: null

  // A plugin is not told where it lives. The registry stamps __sourceDir onto
  // every manifest it scans (PluginRegistry.qml:564) and the shell hands the
  // manifest to the service, but only after createObject returns -- so the
  // resolved URL of this very file is the value available at load.
  readonly property string pluginPath: {
    var stamped = root.manifest && root.manifest.__sourceDir ? String(root.manifest.__sourceDir) : ""
    if (stamped) return stamped.replace(/\/+$/, "")
    return String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "").replace(/\/+$/, "")
  }

  property string _scannedPath: ""

  // pluginPath resolves while this object is still initialising, which is
  // before Registry exists to receive it. Nothing may scan until the children
  // are built.
  property bool _ready: false

  function start() {
    if (!root._ready) return
    if (!root.pluginPath || root.pluginPath === root._scannedPath) return
    root._scannedPath = root.pluginPath
    registry.refresh()
  }

  // hyprctl reload wipes every runtime binding, so a config reload is the one
  // moment the shadows have to be laid down again -- and the user's bindings
  // may have changed with it, so the registry is rescanned rather than reused.
  function reinject() {
    root._scannedPath = ""
    root.start()
  }

  Registry {
    id: registry
    pluginPath: root.pluginPath
    onLoaded: function (bindings) {
      console.log("omakey: registry loaded", bindings.length, "bindings")
      injector.apply(bindings)
    }
    onFailed: function (reason) { console.warn("omakey: registry failed:", reason) }
  }

  Injector {
    id: injector
    onApplied: function (count, skipped) {
      console.log("omakey: shadow bindings", skipped ? "already present" : ("injected " + count))
    }
    onFailed: function (reason) { console.warn("omakey: injector failed:", reason) }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (String(event.name) === "configreloaded") root.reinject()
    }
  }

  onPluginPathChanged: root.start()

  Component.onCompleted: {
    root._ready = true
    console.log("omakey: plugin path", root.pluginPath)
    root.start()
  }
}
