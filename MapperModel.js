// Turns a promoted effect into the binding the user could have pressed. The
// seed is derived from the binding dispatchers themselves; anything a
// dispatcher cannot express is learned at runtime instead.

function _normalizeCommand(command) {
  return String(command || "")
    .replace(/^uwsm-app\s+--\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
}

// Bar widgets dispatch through `hyprctl dispatch '<lua expression>'`, which is
// the same expression the registry holds for the keyboard binding. Recovering
// it turns a bar click into an exact match instead of a guess.
function _luaFromDispatch(command) {
  var match = /^hyprctl\s+dispatch\s+'(.*)'$/.exec(String(command || "").trim())
  return match ? match[1] : null
}

function _normalizeLua(expression) {
  return String(expression || "").replace(/\s+/g, "")
}

function seed(bindings) {
  var out = { workspace: {}, close: -1, fullscreen: {}, floatToggle: -1,
              byCommand: {}, byLua: {}, panel: {}, menu: {}, special: {} }

  for (var i = 0; i < (bindings || []).length; i++) {
    var binding = bindings[i]
    if (binding.kind === "exec") {
      var command = _normalizeCommand(binding.arg)
      if (!(command in out.byCommand)) out.byCommand[command] = binding.id
      var panel = /^omarchy-shell\s+shell\s+toggle\s+(\S+)$/.exec(command)
      if (panel && !(panel[1] in out.panel)) out.panel[panel[1]] = binding.id
      // `omarchy-menu toggle` with no argument opens the root menu, which is
      // also what `omarchy-menu toggle root` opens. First scanned wins, so the
      // user is told about one key rather than alternately about two.
      var menu = /^omarchy-menu\s+toggle(?:\s+(\S+))?$/.exec(command)
      if (menu) {
        var menuId = menu[1] || "root"
        if (!(menuId in out.menu)) out.menu[menuId] = binding.id
      }
      continue
    }
    if (binding.kind !== "lua") continue

    out.byLua[_normalizeLua(binding.arg)] = binding.id

    // hl.dsp.focus, not hl.dsp.window.move: the config carries both, and the
    // second moves the window to a workspace rather than switching to it.
    var workspace = /hl\.dsp\.focus\(\{\s*workspace\s*=\s*"([^"]+)"/.exec(binding.arg)
    if (workspace && !(workspace[1] in out.workspace)) out.workspace[workspace[1]] = binding.id

    if (/hl\.dsp\.window\.close\(\)/.test(binding.arg) && out.close < 0) out.close = binding.id

    var special = /hl\.dsp\.workspace\.toggle_special\(\s*"([^"]+)"/.exec(binding.arg)
    if (special && !(special[1] in out.special)) out.special[special[1]] = binding.id

    var mode = /hl\.dsp\.window\.fullscreen\(\{\s*mode\s*=\s*"([^"]+)"/.exec(binding.arg)
    if (mode && !(mode[1] in out.fullscreen)) out.fullscreen[mode[1]] = binding.id

    if (/hl\.dsp\.window\.float\(\{\s*action\s*=\s*"toggle"/.test(binding.arg) && out.floatToggle < 0) {
      out.floatToggle = binding.id
    }
  }
  return out
}

// Namespaces that no single binding identifies. The event names the surface,
// not the thing that opened it, so the namespace alone can only ever be a guess
// -- verified on 2026-08-19, when clicking the audio widget drew a hint reading
// SUPER CTRL ALT + D.
//
// The value says whether asking the shell can still name an owner, and how. Two
// of these are ambiguous only on the wire: the shell knows which panel it has
// open and the menu plugin knows which menu it is showing. The other two are
// ambiguous in substance -- the OSD rises on a volume change no key caused and
// a notification arrives on its own -- so there is no key to name however hard
// we ask, and an empty plan is what says so.
var AMBIGUOUS_LAYERS = {
  // All six bar panels are built on qs.Ui/KeyboardPanel and share its namespace.
  "omarchy-keyboard-panel": { kind: "panel" },
  // Eight bindings open a menu, and every one of them opens this namespace.
  "omarchy-menu": { kind: "menu", pluginId: "omarchy.menu", property: "activeMenu" },
  "omarchy-osd": null,
  "omarchy-notifications": null
}

function _isAmbiguousLayer(namespace) {
  return String(namespace || "") in AMBIGUOUS_LAYERS
}

// How to ask the shell who opened this surface, or null when asking is either
// pointless or not needed. Holding the plan here keeps the QML side to the one
// thing it is for: making the call.
function samplingFor(namespace) {
  return AMBIGUOUS_LAYERS[String(namespace || "")] || null
}

// A surface no key opens, as opposed to one the mapper simply could not place.
// The two look identical in a log and only one of them is worth reading.
function namesNoKey(namespace) {
  return _isAmbiguousLayer(namespace) && !samplingFor(namespace)
}

// Which panel is open, given the shell's answer for one id at a time. The
// candidates are the panels a binding opens plus whatever else the shell can
// name: a panel no command mentions -- `omarchy-menu toggle reminder-set`
// raises the reminders panel -- is exactly the one a keypress has to be able to
// pair, so the walk has to reach it. Whether a key exists for it is resolve()'s
// question, not this one's. Two open at once names neither.
//
// The predicate is injected so the rule stays here rather than in the QML that
// makes the call.
function panelOwner(seedMap, knownIds, isOpen) {
  var candidates = []
  var id
  for (id in ((seedMap && seedMap.panel) || {})) candidates.push(id)
  for (var i = 0; i < (knownIds || []).length; i++) candidates.push(knownIds[i])

  var asked = {}
  var found = ""
  for (var j = 0; j < candidates.length; j++) {
    id = candidates[j]
    if (asked[id]) continue
    asked[id] = true
    if (!isOpen(id)) continue
    if (found) return ""
    found = id
  }
  return found
}

function _pluginIdFromNamespace(namespace) {
  return String(namespace || "").replace(/-/g, ".")
}

function _hit(bindingId, actionKey) {
  return (bindingId === undefined || bindingId === null || bindingId < 0)
    ? null : { bindingId: bindingId, actionKey: actionKey }
}

function resolve(seedMap, learned, promotion) {
  learned = learned || {}

  if (promotion.tier === "A") {
    var lua = _luaFromDispatch(promotion.command)
    if (lua !== null) {
      var byLua = seedMap.byLua[_normalizeLua(lua)]
      var workspace = /workspace\s*=\s*"([^"]+)"/.exec(lua)
      return _hit(byLua, workspace ? "workspace:" + workspace[1] : "lua:" + _normalizeLua(lua))
    }
    var command = _normalizeCommand(promotion.command)
    return _hit(seedMap.byCommand[command], "exec:" + command)
  }

  var effect = promotion.effect || {}
  var args = effect.args || []

  if (effect.name === "workspacev2") return _hit(seedMap.workspace[args[1] || args[0]], "workspace:" + (args[1] || args[0]))
  if (effect.name === "closewindow") return _hit(seedMap.close, "close")
  if (effect.name === "changefloatingmode") return _hit(seedMap.floatToggle, "float")
  if (effect.name === "fullscreen") return _hit(seedMap.fullscreen["fullscreen"], "fullscreen")

  // `activespecial>>special:scratchpad,eDP-1` on entry, `activespecial>>,eDP-1`
  // on exit. The exit carries no name, so only entering a special workspace can
  // be attributed to a binding.
  if (effect.name === "activespecial") {
    var special = String(args[0] || "").replace(/^special:/, "")
    if (!special) return null
    return _hit(seedMap.special[special], "special:" + special)
  }

  // Nothing in the string "omarchy-launch-terminal" says which window class it
  // opens, so these two are learned rather than parsed. See learn() below.
  if (effect.name === "openwindow") {
    var cls = String(args[2] || "")
    var learnedClass = (learned.class || {})[cls]
    return _hit(learnedClass, "class:" + cls)
  }

  if (effect.name === "openlayer") {
    var namespace = String(args[0] || "")
    // A sampled namespace answers through whoever the shell said opened it.
    // Without an owner -- the shell could not say, or nothing sampled it -- the
    // honest answer is still nothing. Which table applies follows from the
    // namespace, so the sampler hands back an id and nothing else.
    var plan = samplingFor(namespace)
    if (plan) {
      var owner = effect.owner
      if (!owner) return null
      if (plan.kind === "menu") return _hit(seedMap.menu[owner], "menu:" + owner)
      // Learned first: a panel the user has opened with its key is paired
      // exactly, where the seed can only know the panels a command names.
      var learnedPanel = (learned.panel || {})[owner]
      if (learnedPanel !== undefined) return _hit(learnedPanel, "layer:" + owner)
      return _hit(seedMap.panel[owner], "layer:" + owner)
    }
    if (_isAmbiguousLayer(namespace)) return null
    var learnedLayer = (learned.layer || {})[namespace]
    if (learnedLayer !== undefined) return _hit(learnedLayer, "layer:" + namespace)
    // The panel seed is keyed by plugin id and the event by layer namespace.
    // Omarchy's panels declare the id with its dots turned into dashes, so the
    // two meet without waiting for a keypress to teach the pairing.
    return _hit(seedMap.panel[_pluginIdFromNamespace(namespace)], "layer:" + namespace)
  }

  return null
}

// Called when a shadow and an effect arrive together: the keyboard did this, so
// the binding that fired is the binding that produces this effect. This is what
// covers exec bindings, which no amount of parsing can resolve -- nothing in the
// string "omarchy-launch-terminal" says which window class it opens.
function learn(learned, bindingId, effect) {
  var next = { class: {}, layer: {}, panel: {} }
  var source = learned || {}
  var key
  for (key in (source.class || {})) next.class[key] = source.class[key]
  for (key in (source.layer || {})) {
    if (!_isAmbiguousLayer(key)) next.layer[key] = source.layer[key]
  }
  for (key in (source.panel || {})) next.panel[key] = source.panel[key]

  var args = (effect && effect.args) || []
  if (effect && effect.name === "openwindow" && args[2]) next.class[String(args[2])] = bindingId
  // The surface they share stays unlearnable; the owner sampled from it does
  // not. One keypress is what pairs a panel whose command never names it.
  else if (effect && effect.name === "openlayer" && samplingFor(args[0]) && effect.owner) {
    next.panel[String(effect.owner)] = bindingId
  }
  else if (effect && effect.name === "openlayer" && args[0] && !_isAmbiguousLayer(args[0])) {
    next.layer[String(args[0])] = bindingId
  }
  else return source

  return next
}

if (typeof module !== "undefined") module.exports = {
  seed: seed, resolve: resolve, learn: learn,
  samplingFor: samplingFor, panelOwner: panelOwner, namesNoKey: namesNoKey
}
