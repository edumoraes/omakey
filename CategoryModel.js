// Groups bindings into the categories the preferences panel toggles. The
// category comes from the file that declared the binding, which the scanner
// recovers by walking the Lua stack -- so it reflects the config the user
// actually runs rather than a table this file has to keep in step.

// Omarchy ships six binding files; folding them into four keeps the panel
// short. This table is a display convenience, never a filter: see categorize().
var GROUPS = {
  tiling: "windows",
  utilities: "system",
  clipboard: "system",
  voxtype: "system",
  applications: "applications",
  media: "media"
}

var LABELS = {
  windows: "Windows",
  system: "System",
  applications: "Applications",
  media: "Media",
  other: "Other"
}

function _basename(source) {
  var path = String(source || "")
  var slash = path.lastIndexOf("/")
  var file = slash < 0 ? path : path.slice(slash + 1)
  return file.replace(/\.lua$/, "")
}

function _label(id) {
  if (LABELS[id]) return LABELS[id]
  var text = String(id || "")
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Other"
}

// A grouping table's one real failure mode is going stale and losing bindings
// without saying so. An unrecognised file becomes its own category instead, so
// a reorganised Omarchy -- or the user's own bindings file -- shows up as a new
// row in the panel rather than as bindings that quietly stop being promotable.
function categorize(source) {
  var base = _basename(source)
  if (!base) return { id: "other", label: LABELS.other }
  var id = GROUPS[base] || base
  return { id: id, label: _label(id) }
}

function categoryOf(binding) {
  return categorize(binding && binding.source).id
}

// Busiest first: the categories worth muting are the ones that speak most.
function summarize(bindings) {
  var order = []
  var counts = {}
  var labels = {}

  for (var i = 0; i < (bindings || []).length; i++) {
    var category = categorize(bindings[i] && bindings[i].source)
    if (!(category.id in counts)) {
      counts[category.id] = 0
      labels[category.id] = category.label
      order.push(category.id)
    }
    counts[category.id] += 1
  }

  var out = []
  for (var j = 0; j < order.length; j++) {
    out.push({ id: order[j], label: labels[order[j]], count: counts[order[j]] })
  }
  // Ties keep discovery order, so the panel does not reshuffle between scans.
  out.sort(function (left, right) { return right.count - left.count })
  return out
}

function isMuted(mutedCategories, categoryId) {
  if (!Array.isArray(mutedCategories)) return false
  return mutedCategories.indexOf(categoryId) !== -1
}

if (typeof module !== "undefined") module.exports = {
  categorize: categorize, categoryOf: categoryOf,
  summarize: summarize, isMuted: isMuted
}
