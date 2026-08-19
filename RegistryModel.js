// Parses the TSV the Lua scanner prints into binding objects, and renders a
// binding as the combo label the toast shows.

var MODIFIER_NAMES = [
  [64, "SUPER"], [1, "SHIFT"], [4, "CTRL"], [8, "ALT"]
]

// Hyprland reports the number row and punctuation as keycodes, so a raw label
// would read "SUPER + code:12" -- not something a user can act on. This is the
// fallback table omarchy-menu-keybindings carries for the same reason, and it
// covers every code: binding in the default config that omakey can promote.
// Anything outside it is left verbatim rather than guessed at.
var KEYCODE_NAMES = {
  "10": "1", "11": "2", "12": "3", "13": "4", "14": "5",
  "15": "6", "16": "7", "17": "8", "18": "9", "19": "0",
  "20": "MINUS", "21": "EQUAL",
  "59": "COMMA", "60": "PERIOD", "61": "SLASH"
}

var MOUSE_NAMES = {
  "272": "LEFT MOUSE BUTTON",
  "273": "RIGHT MOUSE BUTTON",
  "274": "MIDDLE MOUSE BUTTON"
}

function keyLabel(key) {
  var raw = String(key || "")
  var code = /^code:(\d+)$/.exec(raw)
  if (code) return KEYCODE_NAMES[code[1]] || raw
  var mouse = /^mouse:(\d+)$/.exec(raw)
  if (mouse) return MOUSE_NAMES[mouse[1]] || raw
  return raw
}

function parseRegistry(text) {
  var bindings = []
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var fields = lines[i].split("\t")
    // Six fields is the pre-source format. Such a line still parses; its
    // binding simply has no category rather than being dropped.
    if (fields.length < 6) continue
    var modmask = parseInt(fields[1], 10)
    if (!isFinite(modmask)) continue
    bindings.push({
      id: bindings.length,
      keys: fields[0],
      modmask: modmask,
      key: fields[2],
      description: fields[3],
      kind: fields[4],
      arg: fields[5],
      source: fields[6] || ""
    })
  }
  return bindings
}

function comboLabel(binding) {
  var modmask = Number(binding && binding.modmask) || 0
  var names = []
  for (var i = 0; i < MODIFIER_NAMES.length; i++) {
    if (modmask & MODIFIER_NAMES[i][0]) names.push(MODIFIER_NAMES[i][1])
  }
  var key = keyLabel(binding && binding.key)
  return names.length ? names.join(" ") + " + " + key : key
}

if (typeof module !== "undefined") module.exports = { parseRegistry: parseRegistry, comboLabel: comboLabel, keyLabel: keyLabel }
