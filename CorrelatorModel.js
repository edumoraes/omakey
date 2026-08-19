// Decides which state changes the user caused with the mouse. Every effect is
// held briefly and promoted only if no shadow binding explains it -- a shadow
// means a key was pressed, and a keypress needs no promoting.

// Effect events omakey can promote, and the confidence tier each belongs to.
// Tier A never comes from an effect -- it comes from a captured command.
var EFFECTS = {
  "workspacev2": "B",
  "openwindow": "B",
  "openlayer": "B",
  "activespecial": "B",
  "closewindow": "C",
  "fullscreen": "C",
  "changefloatingmode": "C"
}

function createState(config) {
  var graceMs = Number(config && config.graceMs) || 150
  return {
    graceMs: graceMs,
    // How far back a shadow still explains an effect. Defaults to graceMs, so
    // a config naming only a grace window gets a symmetric one.
    shadowMs: Number(config && config.shadowMs) || graceMs,
    pending: [],
    lastShadowAt: -1,
    lastShadowId: -1,
    lastCommandAt: -1,
    // Tier C only passes if the cursor moved this recently before the effect.
    cursorIdleMs: Number(config && config.cursorIdleMs) || 800,
    cursorMovingAt: -1,
    cursorIdleAt: -1,
    cursorAt: null,
    geometry: {},
    ready: [],
    // Effects a shadow explained. Suppressed for promotion, but kept: they are
    // the only evidence of which binding produces which effect.
    suppressed: []
  }
}

function _isOmakeyEvent(parsed) {
  return parsed.name === "custom" && parsed.args && parsed.args[0] === "omakey"
}

// The shadow fires on the keypress and the effect follows it -- measured at
// 309 ms for an exec binding, where the gap is the spawned process starting.
// So the backward window is the wide one. A shadow arriving *after* its effect
// can only be event reordering, which is a matter of milliseconds.
function _explainedByShadow(state, effect) {
  if (state.lastShadowAt < 0) return false
  var lead = effect.at - state.lastShadowAt
  return lead >= 0 ? lead <= state.shadowMs : -lead <= state.graceMs
}

function ingest(state, parsed) {
  if (!parsed || !parsed.name) return

  if (_isOmakeyEvent(parsed)) {
    var payload = String(parsed.args[1] || "")
    // "cursor:moving:<x>:<y>" -- colon-separated because socket2 splits the
    // event payload on commas.
    if (payload.indexOf("cursor:") === 0) {
      var cursor = payload.split(":")
      if (cursor[1] === "moving") state.cursorMovingAt = parsed.at
      else state.cursorIdleAt = parsed.at
      var x = Number(cursor[2])
      var y = Number(cursor[3])
      if (isFinite(x) && isFinite(y)) state.cursorAt = { x: x, y: y }
      return
    }
    state.lastShadowAt = parsed.at
    state.lastShadowId = parseInt(payload, 10)
    // Suppress anything already waiting that this keypress explains.
    state.pending = state.pending.filter(function (item) {
      if (parsed.at - item.effect.at > state.graceMs) return true
      state.suppressed.push({ bindingId: state.lastShadowId, effect: item.effect })
      return false
    })
    return
  }

  var tier = EFFECTS[parsed.name]
  if (!tier) return

  // omakey's own toast is a layer surface. Without this, showing a hint emits
  // openlayer, which promotes, which shows another hint.
  if (parsed.name === "openlayer" && String((parsed.args || [])[0] || "").indexOf("omakey") === 0) return

  // A command captured moments ago already explains this effect, with a better
  // answer than the mapper could produce. This reads lastCommandAt rather than
  // the ready queue: flush() drains ready on every tick, so a queue check would
  // only ever see commands from the current 50 ms window.
  if (state.lastCommandAt >= 0 && parsed.at - state.lastCommandAt <= state.graceMs) return

  state.pending.push({ effect: parsed, tier: tier, due: parsed.at + state.graceMs })
}

// Hyprland reports window addresses bare on socket2 ("55ba0ae078a0") and
// prefixed through hyprctl ("0x55ba0ae078a0").
function _address(value) {
  return String(value || "").replace(/^0x/, "")
}

function setGeometry(state, address, rect) {
  state.geometry[_address(address)] = rect
}

// `hyprctl clients -j` is the geometry source: Quickshell's Hyprland module
// ships no type information for its toplevel list, while the hyprctl JSON is a
// documented contract carrying address, at and size.
function setGeometryFromClients(state, clients) {
  for (var i = 0; i < (clients || []).length; i++) {
    var client = clients[i]
    if (!client || !client.address) continue
    var at = client.at || []
    var size = client.size || []
    if (at.length < 2 || size.length < 2) continue
    state.geometry[_address(client.address)] = {
      x: Number(at[0]), y: Number(at[1]),
      width: Number(size[0]), height: Number(size[1])
    }
  }
}

function _cursorInside(cursor, rect) {
  return !!cursor && !!rect &&
    cursor.x >= rect.x && cursor.x <= rect.x + rect.width &&
    cursor.y >= rect.y && cursor.y <= rect.y + rect.height
}

// A window closing is far more often the application's own Ctrl+W than a click
// on a titlebar button, so tier C has to earn its promotion: the cursor must
// have moved just before, and for a close it must have been over the window
// that closed. When the gate cannot judge -- no geometry, no position -- it
// suppresses. Spec section 9.
function _cursorAllows(state, item) {
  if (item.tier !== "C") return true
  if (state.cursorMovingAt < 0) return false
  if (item.effect.at - state.cursorMovingAt > state.cursorIdleMs) return false
  if (item.effect.name !== "closewindow") return true

  var rect = state.geometry[_address((item.effect.args || [])[0])]
  return _cursorInside(state.cursorAt, rect)
}

function command(state, commandString, at) {
  if (!commandString) return
  state.lastCommandAt = at
  state.ready.push({ tier: "A", effect: null, command: String(commandString), at: at })
}

function flush(state, now) {
  var out = state.ready
  state.ready = []

  var keep = []
  for (var i = 0; i < state.pending.length; i++) {
    var item = state.pending[i]
    if (item.due > now) { keep.push(item); continue }
    if (_explainedByShadow(state, item.effect)) {
      state.suppressed.push({ bindingId: state.lastShadowId, effect: item.effect })
      continue
    }
    if (!_cursorAllows(state, item)) continue
    out.push({ tier: item.tier, effect: item.effect, command: null, at: item.effect.at })
  }
  state.pending = keep
  return out
}

function drainSuppressions(state) {
  var out = state.suppressed
  state.suppressed = []
  return out
}

if (typeof module !== "undefined") module.exports = {
  EFFECTS: EFFECTS, createState: createState, ingest: ingest, command: command,
  flush: flush, drainSuppressions: drainSuppressions, setGeometry: setGeometry,
  setGeometryFromClients: setGeometryFromClients
}
