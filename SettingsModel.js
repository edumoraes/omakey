// Reads omakey's preferences off its shell.json entry, and normalises whatever
// it finds there into values the rest of the plugin can use without checking.

var POSITIONS = [
  "top-left", "top-center", "top-right",
  "bottom-left", "bottom-center", "bottom-right"
]

var INTENSITIES = ["discreet", "balanced", "insistent"]

// Four stops rather than a free number. The dwell time is a feel, not a
// measurement, and a field that accepts 37000 is a way for the user to break
// the hint without noticing. 4000 is what shipped before this was configurable.
var DURATIONS = [2000, 4000, 7000, 10000]

var DEFAULTS = {
  hintsEnabled: true,
  toastPosition: "bottom-center",
  toastDuration: 4000,
  intensity: "balanced",
  mutedCategories: []
}

var SECTIONS = ["left", "center", "right"]

// Mirrors PluginRegistry.findEntryLocation: the bar layout first, plugins[]
// second. A plugin has exactly one entry, and shell.updateEntryInline picks it
// with this same precedence -- so reading it any other way would have the panel
// saving into one object while the service read another.
function resolveEntry(shellConfig, id) {
  var config = shellConfig || null
  if (!config) return null
  var key = String(id || "omakey")

  var layout = config.bar && config.bar.layout ? config.bar.layout : null
  if (layout) {
    for (var s = 0; s < SECTIONS.length; s++) {
      var section = layout[SECTIONS[s]]
      if (!Array.isArray(section)) continue
      for (var i = 0; i < section.length; i++) {
        if (section[i] && String(section[i].id) === key) return section[i]
      }
    }
  }

  if (Array.isArray(config.plugins)) {
    for (var j = 0; j < config.plugins.length; j++) {
      if (config.plugins[j] && String(config.plugins[j].id) === key) return config.plugins[j]
    }
  }

  return null
}

function _oneOf(value, allowed, fallback) {
  return allowed.indexOf(String(value)) === -1 ? fallback : String(value)
}

// The numeric sibling of _oneOf. indexOf alone would accept a numeric string
// off shell.json as a miss, so the value is coerced before it is looked up.
function _oneOfNumber(value, allowed, fallback) {
  var number = Number(value)
  return allowed.indexOf(number) === -1 ? fallback : number
}

// A malformed value must not leave the toast unanchored or the policy
// undefined, so every field falls back rather than propagating.
function read(entry) {
  var source = entry || {}
  var muted = []
  if (Array.isArray(source.mutedCategories)) {
    for (var i = 0; i < source.mutedCategories.length; i++) {
      if (typeof source.mutedCategories[i] === "string") muted.push(source.mutedCategories[i])
    }
  }
  return {
    // Only an explicit false turns the plugin off. Anything else -- a missing
    // key, a string, a null -- leaves it speaking, because silently disabling
    // itself is indistinguishable from being broken.
    hintsEnabled: source.hintsEnabled !== false,
    toastPosition: _oneOf(source.toastPosition, POSITIONS, DEFAULTS.toastPosition),
    intensity: _oneOf(source.intensity, INTENSITIES, DEFAULTS.intensity),
    toastDuration: _oneOfNumber(source.toastDuration, DURATIONS, DEFAULTS.toastDuration),
    mutedCategories: muted
  }
}

function _capitalize(text) {
  var value = String(text || "")
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : ""
}

// Rendered labels belong here rather than inline in the QML, both because the
// house rule keeps logic out of QML and because a label is the one part of a
// setting a test can assert on.
function positionLabel(position) {
  var parts = String(position || "").split("-")
  if (parts.length !== 2) return _capitalize(position)
  return _capitalize(parts[0]) + " " + parts[1]
}

function intensityLabel(intensity) {
  return _capitalize(intensity)
}

function durationLabel(duration) {
  return String(Math.round(Number(duration) / 1000)) + "s"
}

// Where the knob sits. An unrecognised value puts it on the default rather than
// off the track, which is the same fallback read() applies to the value itself.
function durationIndex(duration) {
  var found = DURATIONS.indexOf(Number(duration))
  return found === -1 ? DURATIONS.indexOf(DEFAULTS.toastDuration) : found
}

// omakey's state lives in one place, and both the service that writes it and
// the widget that reads it have to agree on where. Two spellings of the same
// path is the kind of duplication that only shows up once they differ.
function stateDir(home) {
  return String(home || "") + "/.local/state/omakey"
}

function stateFile(home) {
  return stateDir(home) + "/stats.json"
}

function toggleCategory(mutedCategories, categoryId) {
  var current = Array.isArray(mutedCategories) ? mutedCategories : []
  var next = []
  var found = false
  for (var i = 0; i < current.length; i++) {
    if (current[i] === categoryId) found = true
    else next.push(current[i])
  }
  if (!found) next.push(categoryId)
  return next
}

// updateEntryInline rewrites the whole entry from what it is handed, so
// anything on it that this plugin does not know about -- `record`, a field a
// later version adds -- has to be carried across or it is deleted.
function merge(entry, changes) {
  var out = {}
  var key
  for (key in (entry || {})) out[key] = entry[key]
  for (key in (changes || {})) out[key] = changes[key]
  return out
}

if (typeof module !== "undefined") module.exports = {
  POSITIONS: POSITIONS, INTENSITIES: INTENSITIES, DURATIONS: DURATIONS, DEFAULTS: DEFAULTS,
  resolveEntry: resolveEntry, read: read, toggleCategory: toggleCategory, merge: merge,
  positionLabel: positionLabel, intensityLabel: intensityLabel,
  durationLabel: durationLabel, durationIndex: durationIndex,
  stateDir: stateDir, stateFile: stateFile
}
