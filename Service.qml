import QtQuick
import Quickshell
import Quickshell.Hyprland
import "CorrelatorModel.js" as CorrelatorModel

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

  // The shell exposes no per-plugin settings accessor. Settings are inline
  // fields on the plugin's own entry in shell.json's plugins[] array -- see
  // "Storage rules" in /usr/share/omarchy/shell/README.md.
  function settingsEntry() {
    var config = root.shell && root.shell.shellConfig ? root.shell.shellConfig : null
    var entries = config && Array.isArray(config.plugins) ? config.plugins : []
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && String(entries[i].id) === "omakey") return entries[i]
    }
    return null
  }

  function settingBool(key, fallback) {
    var entry = root.settingsEntry()
    return entry && (key in entry) ? entry[key] === true : fallback
  }

  // 150 ms is long enough to catch a shadow that arrives after its effect;
  // 600 ms is the backward window, sized off a measured 309 ms lead for an
  // exec binding. Spec section 12 question 3 records the measurement.
  property var correlatorState: CorrelatorModel.createState({ graceMs: 150, shadowMs: 600 })

  Ingest {
    id: ingest
    recording: root.settingBool("record", false)
    onRecordingChanged: console.log("omakey: recording", recording ? "on" : "off")
    onEvent: function (parsed) { CorrelatorModel.ingest(root.correlatorState, parsed) }
  }

  // A third of the grace window: fine enough that a held effect is never late
  // by more than a frame, coarse enough to cost nothing.
  Timer {
    interval: 50
    running: true
    repeat: true
    onTriggered: {
      var promotions = CorrelatorModel.flush(root.correlatorState, Date.now())
      for (var i = 0; i < promotions.length; i++) root.handlePromotion(promotions[i])
    }
  }

  function handlePromotion(promotion) {
    console.log("omakey: promote", promotion.tier,
      promotion.command || (promotion.effect && promotion.effect.name))
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
