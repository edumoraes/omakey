import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "CorrelatorModel.js" as CorrelatorModel
import "MapperModel.js" as MapperModel
import "PolicyModel.js" as PolicyModel
import "RegistryModel.js" as RegistryModel

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

  function settingInt(key, fallback) {
    var entry = root.settingsEntry()
    var value = entry ? Number(entry[key]) : NaN
    return isFinite(value) ? value : fallback
  }

  readonly property var policyConfig: ({
    quietFirst: root.settingInt("quietFirst", 3),
    learnedAfter: root.settingInt("learnedAfter", 5),
    giveUpAfter: root.settingInt("giveUpAfter", 5),
    cooldownMs: root.settingInt("cooldownMs", 60000)
  })

  // Effect-to-binding seed, rebuilt whenever the registry is rescanned.
  property var seed: ({})

  // What is actually live right now. `commands` is permanently false on this
  // platform: QML refuses to reassign Util.execDetached, so there is no
  // in-process hook for menu and bar commands. Spec section 12 question 1.
  readonly property var capabilities: ({
    registry: registry.bindings.length > 0,
    shadows: injector.injected,
    commands: false
  })

  readonly property var tiers: PolicyModel.tiersEnabled(root.capabilities)

  // One line a bug reporter can paste that explains what was actually live.
  // The tiers are recomputed here rather than read off root.tiers: that binding
  // has not necessarily re-evaluated by the time this handler runs, and a line
  // pairing fresh capabilities with stale tiers is worse than no line at all.
  onCapabilitiesChanged: console.log("omakey: capabilities",
    JSON.stringify(root.capabilities),
    "tiers", JSON.stringify(PolicyModel.tiersEnabled(root.capabilities)))

  // 150 ms is long enough to catch a shadow that arrives after its effect;
  // 600 ms is the backward window, sized off a measured 309 ms lead for an
  // exec binding. Spec section 12 question 3 records the measurement.
  property var correlatorState: CorrelatorModel.createState({
    graceMs: 150, shadowMs: 600, cursorIdleMs: root.settingInt("cursorIdleMs", 800)
  })

  Ingest {
    id: ingest
    recording: root.settingBool("record", false)
    onRecordingChanged: console.log("omakey: recording", recording ? "on" : "off")
    // Until the shadows are live, no keypress can announce itself, so every
    // effect looks manual -- including the shell's own layer surfaces coming up
    // at startup. Spec section 9: a detector that cannot be trusted says
    // nothing rather than guessing.
    onEvent: function (parsed) {
      if (!injector.injected) return
      CorrelatorModel.ingest(root.correlatorState, parsed)
      // The gate needs a window's geometry as it was just before it closed, so
      // the cache is refreshed when windows appear or move, never on the close
      // itself.
      if (parsed.name === "openwindow" || parsed.name === "movewindow"
        || parsed.name === "resizewindow" || parsed.name === "closewindow") geometryDebounce.restart()
    }
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

      var lessons = CorrelatorModel.drainSuppressions(root.correlatorState)
      for (var j = 0; j < lessons.length; j++) root.handleLesson(lessons[j])
    }
  }

  function handlePromotion(promotion) {
    var allowed = promotion.tier === "A" ? root.tiers.commands : root.tiers.effects
    if (!allowed) return

    var hit = MapperModel.resolve(root.seed, store.learned || {}, promotion)
    if (!hit) return

    var result = PolicyModel.recordManual(store.stats || {}, hit.actionKey, Date.now(), root.policyConfig)
    store.stats = result.stats
    store.scheduleSave()

    if (!result.show) {
      console.log("omakey: silent", hit.actionKey, result.reason)
      return
    }
    root.showHint(hit)
  }

  function showHint(hit) {
    var binding = registry.bindings[hit.bindingId]
    if (!binding) return
    if (!root.shell || typeof root.shell.summon !== "function") return

    var combo = RegistryModel.comboLabel(binding)
    console.log("omakey: hint", hit.actionKey, combo)
    root.shell.summon("omakey", JSON.stringify({
      combo: combo,
      description: binding.description || "",
      actionKey: hit.actionKey
    }))
  }

  // A shadow and an effect arriving together means the keyboard did this, so
  // the binding that fired is the binding that produces this effect. It is the
  // only signal that ever maps an exec binding -- and it is also adoption: the
  // user just did with the keyboard the thing omakey would have suggested.
  function handleLesson(lesson) {
    var current = store.learned || {}
    var next = MapperModel.learn(current, lesson.bindingId, lesson.effect)
    if (next !== current) {
      store.learned = next
      store.scheduleSave()
      console.log("omakey: learned", lesson.effect.name, "->", lesson.bindingId)
    }

    var hit = MapperModel.resolve(root.seed, store.learned || {},
      { tier: "B", command: null, effect: lesson.effect })
    if (hit) root.handleAdoption(hit.actionKey)
  }

  // Adoption is what makes a hint fade, and what resets self-demotion.
  function handleAdoption(actionKey) {
    store.stats = PolicyModel.recordBind(store.stats || {}, actionKey, Date.now())
    store.scheduleSave()
  }

  function mute(actionKey) {
    store.stats = PolicyModel.mute(store.stats || {}, actionKey)
    store.scheduleSave()
    console.log("omakey: muted", actionKey)
  }

  Store { id: store }

  // Quickshell's Hyprland module ships no type information for its toplevel
  // list; `hyprctl clients -j` is a documented contract carrying address, at
  // and size. Debounced because a window drag emits a burst of movewindow.
  Timer {
    id: geometryDebounce
    interval: 250
    onTriggered: if (!clients.running) { clients.buffer = ""; clients.running = true }
  }

  Process {
    id: clients
    command: ["hyprctl", "clients", "-j"]
    property string buffer: ""
    stdout: SplitParser {
      onRead: function (line) { clients.buffer += line }
    }
    onExited: function (exitCode) {
      if (exitCode !== 0) return
      try {
        CorrelatorModel.setGeometryFromClients(root.correlatorState, JSON.parse(clients.buffer))
      } catch (error) {
        console.warn("omakey: clients parse failed:", error)
      }
    }
  }

  Registry {
    id: registry
    pluginPath: root.pluginPath
    onLoaded: function (bindings) {
      console.log("omakey: registry loaded", bindings.length, "bindings")
      root.seed = MapperModel.seed(bindings)
      injector.apply(bindings)
    }
    onFailed: function (reason) { console.warn("omakey: registry failed:", reason) }
  }

  Injector {
    id: injector
    pluginPath: root.pluginPath
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
