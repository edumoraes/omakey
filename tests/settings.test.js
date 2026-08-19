const { test } = require("node:test")
const assert = require("node:assert")
const Settings = require("../SettingsModel.js")

// Mirrors PluginRegistry.findEntryLocation: the bar layout is searched first
// and plugins[] second. Read and write have to agree on which entry is
// authoritative, or the panel saves into one object and the service reads
// another.
test("the bar layout entry wins over a plugins[] entry", () => {
  const config = {
    bar: { layout: { left: [], center: [], right: [{ id: "omakey", intensity: "insistent" }] } },
    plugins: [{ id: "omakey", intensity: "discreet" }]
  }
  assert.strictEqual(Settings.resolveEntry(config, "omakey").intensity, "insistent")
})

test("plugins[] is used when the widget is not on the bar", () => {
  const config = { bar: { layout: { left: [], center: [], right: [] } }, plugins: [{ id: "omakey", intensity: "discreet" }] }
  assert.strictEqual(Settings.resolveEntry(config, "omakey").intensity, "discreet")
})

test("every bar section is searched", () => {
  const config = { bar: { layout: { left: [{ id: "omakey" }], center: [], right: [] } }, plugins: [] }
  assert.ok(Settings.resolveEntry(config, "omakey"))
})

test("an absent plugin resolves to null", () => {
  assert.strictEqual(Settings.resolveEntry({ bar: {}, plugins: [] }, "omakey"), null)
  assert.strictEqual(Settings.resolveEntry(null, "omakey"), null)
})

test("defaults apply when there is no entry at all", () => {
  const settings = Settings.read(null)
  assert.strictEqual(settings.toastPosition, "bottom-center")
  assert.strictEqual(settings.intensity, "balanced")
  assert.deepStrictEqual(settings.mutedCategories, [])
})

test("valid values are carried through", () => {
  const settings = Settings.read({ id: "omakey", toastPosition: "top-right", intensity: "discreet", mutedCategories: ["windows"] })
  assert.strictEqual(settings.toastPosition, "top-right")
  assert.strictEqual(settings.intensity, "discreet")
  assert.deepStrictEqual(settings.mutedCategories, ["windows"])
})

// A malformed value must not leave the toast unanchored or the policy
// undefined. Falling back is the only behaviour that keeps the plugin usable.
test("an unrecognised value falls back to the default", () => {
  const settings = Settings.read({ toastPosition: "middle-of-nowhere", intensity: "screaming" })
  assert.strictEqual(settings.toastPosition, "bottom-center")
  assert.strictEqual(settings.intensity, "balanced")
})

test("a non-array mutedCategories reads as empty", () => {
  assert.deepStrictEqual(Settings.read({ mutedCategories: "windows" }).mutedCategories, [])
  assert.deepStrictEqual(Settings.read({ mutedCategories: null }).mutedCategories, [])
})

test("mutedCategories keeps only strings", () => {
  assert.deepStrictEqual(Settings.read({ mutedCategories: ["windows", 3, null, "media"] }).mutedCategories, ["windows", "media"])
})

test("the six toast positions are the supported set", () => {
  assert.deepStrictEqual(Settings.POSITIONS, [
    "top-left", "top-center", "top-right",
    "bottom-left", "bottom-center", "bottom-right"
  ])
})

test("toggle adds and removes a category without mutating the input", () => {
  const before = ["windows"]
  assert.deepStrictEqual(Settings.toggleCategory(before, "media"), ["windows", "media"])
  assert.deepStrictEqual(Settings.toggleCategory(before, "windows"), [])
  assert.deepStrictEqual(before, ["windows"])
})

// updateEntryInline rewrites the whole entry from what it is given, so the
// merge has to preserve fields this plugin does not know about.
test("merge keeps unknown fields on the entry", () => {
  const merged = Settings.merge({ id: "omakey", record: true }, { intensity: "discreet" })
  assert.strictEqual(merged.record, true)
  assert.strictEqual(merged.intensity, "discreet")
  assert.strictEqual(merged.id, "omakey")
})

test("position labels read as prose, not as config keys", () => {
  assert.strictEqual(Settings.positionLabel("bottom-center"), "Bottom center")
  assert.strictEqual(Settings.positionLabel("top-left"), "Top left")
})

test("intensity labels are capitalised", () => {
  assert.strictEqual(Settings.intensityLabel("insistent"), "Insistent")
})

// The service writes this file and the widget reads it; one spelling of the
// path is the only thing keeping them pointed at the same place.
test("the state path has a single definition", () => {
  assert.strictEqual(Settings.stateDir("/home/me"), "/home/me/.local/state/omakey")
  assert.strictEqual(Settings.stateFile("/home/me"), "/home/me/.local/state/omakey/stats.json")
})

// The master switch. It defaults to on, because a plugin that installs itself
// silent is a plugin the user thinks is broken.
test("hints are enabled unless the entry says otherwise", () => {
  assert.strictEqual(Settings.read(null).hintsEnabled, true)
  assert.strictEqual(Settings.read({}).hintsEnabled, true)
  assert.strictEqual(Settings.read({ hintsEnabled: false }).hintsEnabled, false)
})

test("a non-boolean hintsEnabled does not silence the plugin by accident", () => {
  assert.strictEqual(Settings.read({ hintsEnabled: "false" }).hintsEnabled, true)
  assert.strictEqual(Settings.read({ hintsEnabled: null }).hintsEnabled, true)
})

// The dwell time ships as four stops rather than a free number: a hint that
// lingers for 37 seconds is a bug the user built for themselves.
test("the default dwell time is the second stop", () => {
  assert.strictEqual(Settings.read(null).toastDuration, 4000)
  assert.strictEqual(Settings.DURATIONS[1], 4000)
})

test("a valid stop is carried through", () => {
  assert.strictEqual(Settings.read({ id: "omakey", toastDuration: 7000 }).toastDuration, 7000)
})

test("a dwell time off the stops falls back rather than reaching the timer", () => {
  assert.strictEqual(Settings.read({ toastDuration: 3333 }).toastDuration, 4000)
  assert.strictEqual(Settings.read({ toastDuration: "long" }).toastDuration, 4000)
  assert.strictEqual(Settings.read({ toastDuration: null }).toastDuration, 4000)
  assert.strictEqual(Settings.read({ toastDuration: 0 }).toastDuration, 4000)
})

test("the slider position follows the stored value", () => {
  assert.strictEqual(Settings.durationIndex(2000), 0)
  assert.strictEqual(Settings.durationIndex(4000), 1)
  assert.strictEqual(Settings.durationIndex(10000), 3)
  // An unknown value puts the knob on the default rather than off the track.
  assert.strictEqual(Settings.durationIndex(3333), 1)
})

test("the dwell time reads as seconds", () => {
  assert.strictEqual(Settings.durationLabel(2000), "2s")
  assert.strictEqual(Settings.durationLabel(10000), "10s")
})

test("changing the dwell time keeps a field this version does not know", () => {
  const merged = Settings.merge({ id: "omakey", record: true }, { toastDuration: 7000 })
  assert.strictEqual(merged.record, true)
  assert.strictEqual(merged.toastDuration, 7000)
})
