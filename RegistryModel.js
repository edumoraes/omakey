// Parses the TSV the Lua scanner prints into binding objects, and renders a
// binding as the combo label the toast shows.

var MODIFIER_NAMES = [
  [64, "SUPER"], [1, "SHIFT"], [4, "CTRL"], [8, "ALT"]
]

function parseRegistry(text) {
  var bindings = []
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var fields = lines[i].split("\t")
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
      arg: fields.slice(5).join("\t")
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
  var key = String((binding && binding.key) || "")
  return names.length ? names.join(" ") + " + " + key : key
}

if (typeof module !== "undefined") module.exports = { parseRegistry: parseRegistry, comboLabel: comboLabel }
