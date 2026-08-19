// Builds the Lua omakey injects into the live compositor: one shadow binding
// per registered binding, each emitting `custom>>omakey,<id>` on socket2.

function luaString(value) {
  return '"' + String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n") + '"'
}

// No description: omarchy-menu-keybindings filters out descriptionless __lua
// bindings, which is what keeps 228 lines of noise out of the user's cheat
// sheet. Adding one here would be visible to the user immediately.
function buildChunks(bindings, chunkSize) {
  var size = Number(chunkSize) > 0 ? Number(chunkSize) : 40
  var chunks = []
  var lines = []

  for (var i = 0; i < (bindings || []).length; i++) {
    var binding = bindings[i]
    if (!binding || !binding.keys) continue
    lines.push(
      "hl.bind(" + luaString(binding.keys) +
      ", hl.dsp.event(" + luaString("omakey," + binding.id) + "), {})"
    )
    if (lines.length >= size) { chunks.push(lines.join("\n")); lines = [] }
  }

  if (lines.length) chunks.push(lines.join("\n"))
  return chunks
}

if (typeof module !== "undefined") module.exports = { buildChunks: buildChunks, luaString: luaString }
