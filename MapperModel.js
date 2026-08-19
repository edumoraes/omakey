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
              byCommand: {}, byLua: {}, panel: {} }

  for (var i = 0; i < (bindings || []).length; i++) {
    var binding = bindings[i]
    if (binding.kind === "exec") {
      var command = _normalizeCommand(binding.arg)
      if (!(command in out.byCommand)) out.byCommand[command] = binding.id
      var panel = /^omarchy-shell\s+shell\s+toggle\s+(\S+)$/.exec(command)
      if (panel && !(panel[1] in out.panel)) out.panel[panel[1]] = binding.id
      continue
    }
    if (binding.kind !== "lua") continue

    out.byLua[_normalizeLua(binding.arg)] = binding.id

    // hl.dsp.focus, not hl.dsp.window.move: the config carries both, and the
    // second moves the window to a workspace rather than switching to it.
    var workspace = /hl\.dsp\.focus\(\{\s*workspace\s*=\s*"([^"]+)"/.exec(binding.arg)
    if (workspace && !(workspace[1] in out.workspace)) out.workspace[workspace[1]] = binding.id

    if (/hl\.dsp\.window\.close\(\)/.test(binding.arg) && out.close < 0) out.close = binding.id

    var mode = /hl\.dsp\.window\.fullscreen\(\{\s*mode\s*=\s*"([^"]+)"/.exec(binding.arg)
    if (mode && !(mode[1] in out.fullscreen)) out.fullscreen[mode[1]] = binding.id

    if (/hl\.dsp\.window\.float\(\{\s*action\s*=\s*"toggle"/.test(binding.arg) && out.floatToggle < 0) {
      out.floatToggle = binding.id
    }
  }
  return out
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

  // Nothing in the string "omarchy-launch-terminal" says which window class it
  // opens, so these two are learned rather than parsed. See learn() below.
  if (effect.name === "openwindow") {
    var cls = String(args[2] || "")
    var learnedClass = (learned.class || {})[cls]
    return _hit(learnedClass, "class:" + cls)
  }

  if (effect.name === "openlayer") {
    var namespace = String(args[0] || "")
    var learnedLayer = (learned.layer || {})[namespace]
    if (learnedLayer !== undefined) return _hit(learnedLayer, "layer:" + namespace)
    return null
  }

  return null
}

if (typeof module !== "undefined") module.exports = { seed: seed, resolve: resolve }
