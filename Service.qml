import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "CategoryModel.js" as CategoryModel
import "CorrelatorModel.js" as CorrelatorModel
import "MapperModel.js" as MapperModel
import "PolicyModel.js" as PolicyModel
import "RegistryModel.js" as RegistryModel
import "SettingsModel.js" as SettingsModel

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
  // fields on the plugin's own entry in shell.json -- see "Storage rules" in
  // /usr/share/omarchy/shell/README.md.
  //
  // That entry is in bar.layout when omakey is on the bar and in plugins[]
  // otherwise, never both: PluginRegistry.findEntryLocation searches them in
  // that order and returns one location. The precedence has to match, because
  // shell.updateEntryInline -- the write path the panel uses -- picks the entry
  // the same way.
  function settingsEntry() {
    var config = root.shell && root.shell.shellConfig ? root.shell.shellConfig : null
    return SettingsModel.resolveEntry(config, "omakey")
  }

  readonly property var settings: {
    var config = root.shell && root.shell.shellConfig ? root.shell.shellConfig : null
    return SettingsModel.read(SettingsModel.resolveEntry(config, "omakey"))
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

  readonly property var policyConfig: PolicyModel.configFor(root.settings.intensity)

  // Effect-to-binding seed, rebuilt whenever the registry is rescanned.
  property var seed: ({})

  // What is actually live right now. `commands` is permanently false on this
  // platform: QML refuses to reassign Util.execDetached, so there is no
  // in-process hook for menu and bar commands. Spec section 12 question 1.
  readonly property var capabilities: ({
    registry: registry.bindings.length > 0,
    shadows: injector.injected,
    commands: false,
    // Whether the shell can be asked who opened a shared layer surface. Probed
    // once here rather than per event, so the answer travels in the one line a
    // bug reporter pastes instead of hiding behind a generic silence.
    owners: !!root.shell && typeof root.shell.isPluginOpen === "function"
  })

  readonly property var tiers: PolicyModel.tiersEnabled(root.capabilities)

  onSettingsChanged: {
    console.log("omakey: settings", JSON.stringify(root.settings),
      "from", root.settingsEntry() ? "shell.json entry" : "defaults")
    root.applyReset()
  }

  // The panel cannot call in here -- a bar widget is handed bar, moduleName and
  // settings, never the service -- so the reset button stamps a timestamp onto
  // the shell.json entry both halves already share. The stamp the service has
  // acted on is kept in the state file, so a reset fires once and not again on
  // every restart.
  function applyReset() {
    if (!store.loaded) return
    if (root.settings.resetAt <= store.resetAt) return
    store.stats = {}
    store.resetAt = root.settings.resetAt
    // Saved now rather than on the debounce: the user just asked for this, and
    // a shell that dies in the next two seconds must not restore what they
    // cleared.
    store.save()
    console.log("omakey: learning reset")
  }

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
      // Sampled here rather than at promotion time. The promotion is a grace
      // window later, and by then the user may have walked from the root menu
      // into a submenu -- the shell would answer honestly about the wrong menu.
      if (parsed.name === "openlayer" && root.capabilities.owners) {
        var plan = MapperModel.samplingFor(String((parsed.args || [])[0] || ""))
        if (plan) parsed.owner = root.sampleLayerOwner(plan)
      }
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
    // The master switch, ahead of everything else. Like the category gate, it
    // returns before recordManual so a disabled plugin spends no counters and
    // switching it back on resumes rather than restarts.
    if (!root.settings.hintsEnabled) return

    var allowed = promotion.tier === "A" ? root.tiers.commands : root.tiers.effects
    if (!allowed) return

    var hit = MapperModel.resolve(root.seed, store.learned || {}, promotion)
    // Named, because this silence is the one that looks like a fault: an effect
    // promotes like any other and then names no binding, which without a line
    // here is indistinguishable from the correlator being dead. The OSD and the
    // notification surface are left out -- they promote on every volume change
    // and their silence is the design, so logging them would bury the fault
    // this line exists to show.
    if (!hit) {
      var effect = promotion.effect || {}
      var subject = String((effect.args || [])[0] || "")
      if (!MapperModel.namesNoKey(subject)) {
        // The subject and the sampled owner, because "no-binding" alone cannot
        // tell a surface omakey failed to attribute from one it was never going
        // to: the first is a gap worth closing, the second is the design.
        console.log("omakey: silent", (effect.name || "?") + ":" + subject,
          effect.owner ? "owner=" + effect.owner : "owner=none", "no-binding")
      }
      return
    }

    // The category gate sits ahead of recordManual on purpose. A muted category
    // must not burn its quiet-start budget, advance hintCount, or trip
    // self-demotion -- otherwise unmuting it later would find the counters
    // already spent and it would stay silent anyway. Silence has to be free.
    if (root.categoryMuted(hit.bindingId)) {
      console.log("omakey: silent", hit.actionKey, "category-muted")
      return
    }

    var result = PolicyModel.recordManual(store.stats || {}, hit.actionKey, Date.now(), root.policyConfig)
    store.stats = result.stats
    store.scheduleSave()

    if (!result.show) {
      console.log("omakey: silent", hit.actionKey, result.reason)
      return
    }
    root.showHint(hit)
  }

  // Who opened a surface that several bindings can open. socket2 names the
  // layer and nothing else, but the shell it is running inside knows: which
  // panel it has open, and which menu the menu plugin is showing. Asking costs
  // no process and no round trip.
  //
  // The plan comes from MapperModel; this makes the call and nothing else.
  // Every path out returns "" rather than a guess, and that lands on the same
  // silence omakey has always kept for these namespaces.
  function sampleLayerOwner(plan) {
    if (plan.property) {
      // The shell's plugin API forwards method calls only (shell.qml:565) and
      // the menu exposes no getter, so the active menu is read off the loader
      // the shell publishes -- the same walk the shell itself does for a
      // foreign panel at shell.qml:817, raw plugin id included. Read-only, and
      // a missing loader is an empty answer like any other.
      var loader = (root.shell.panelLoaders || {})[plan.pluginId]
      return loader && loader.item ? String(loader.item[plan.property] || "") : ""
    }
    // Every plugin the shell has, not just the ones a binding names and not
    // just `panelEntries`: that list holds the panel/overlay/menu kinds only,
    // while tailscale, weather and the agents picker are bar widgets with a
    // panel behind them. Leaving those out is what left them unnameable.
    // isPluginOpen answers false for anything that cannot be open, so a wide
    // list costs a walk and buys the panels a keypress can still pair.
    var known = []
    var registry = root.shell.pluginRegistry
    var installed = registry ? registry.installedPlugins : null
    for (var id in (installed || {})) known.push(String(id))
    return MapperModel.panelOwner(root.seed, known, function (candidate) {
      return root.shell.isPluginOpen(candidate)
    })
  }

  function categoryMuted(bindingId) {
    var binding = registry.bindings[bindingId]
    if (!binding) return false
    return CategoryModel.isMuted(root.settings.mutedCategories, CategoryModel.categoryOf(binding))
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
      actionKey: hit.actionKey,
      position: root.settings.toastPosition,
      duration: root.settings.toastDuration
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

  // Adoption is what makes a hint fade, and what resets self-demotion. It is
  // also the successful review that pushes the next reminder further out, which
  // is why the policy config travels with it.
  function handleAdoption(actionKey) {
    store.stats = PolicyModel.recordBind(store.stats || {}, actionKey, Date.now(), root.policyConfig)
    store.scheduleSave()
  }

  function mute(actionKey) {
    store.stats = PolicyModel.mute(store.stats || {}, actionKey)
    store.scheduleSave()
    console.log("omakey: muted", actionKey)
  }

  // The reset stamp may already be on the entry when the service starts, so the
  // check has to run again once the state file is in -- onSettingsChanged alone
  // would have missed it, having fired before the load.
  Store {
    id: store
    onLoadedChanged: if (loaded) root.applyReset()
  }

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
      // The preferences widget needs the category list, and a bar widget is
      // handed only bar/moduleName/settings -- never the service. So the
      // service publishes it through the state file the Store already writes,
      // which keeps omakey down to one file outside its own directory.
      store.categories = CategoryModel.summarize(bindings)
      store.scheduleSave()
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
