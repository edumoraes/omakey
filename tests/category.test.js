const { test } = require("node:test")
const assert = require("node:assert")
const { execFileSync } = require("node:child_process")
const path = require("node:path")
const RegistryModel = require("../RegistryModel.js")
const CategoryModel = require("../CategoryModel.js")

const SCANNER = path.join(__dirname, "..", "lua", "registry.lua")
const MULTIFILE = path.join(__dirname, "fixtures", "multifile", "hyprland.lua")

function scanMultifile() {
  return RegistryModel.parseRegistry(
    execFileSync("lua", [SCANNER, MULTIFILE], { encoding: "utf8" }))
}

test("the scanner attributes a binding to the file that declared it, not the helper", () => {
  const bindings = scanMultifile()
  const close = bindings.find(b => b.description === "Close window")
  assert.match(close.source, /bindings\/tiling\.lua$/)
})

test("every binding is attributed", () => {
  const bindings = scanMultifile()
  assert.strictEqual(bindings.length, 4)
  assert.strictEqual(bindings.filter(b => b.source).length, 4)
})

test("known source files fold into the four groups", () => {
  assert.strictEqual(CategoryModel.categorize("/x/bindings/tiling.lua").id, "windows")
  assert.strictEqual(CategoryModel.categorize("/x/bindings/utilities.lua").id, "system")
  assert.strictEqual(CategoryModel.categorize("/x/bindings/clipboard.lua").id, "system")
  assert.strictEqual(CategoryModel.categorize("/x/bindings/voxtype.lua").id, "system")
  assert.strictEqual(CategoryModel.categorize("/x/bindings/applications.lua").id, "applications")
  assert.strictEqual(CategoryModel.categorize("/x/bindings/media.lua").id, "media")
})

// The whole hazard of a hand-written grouping is a stale table that drops
// bindings without saying so. An unknown file has to surface, not vanish.
test("an unknown source file becomes its own category", () => {
  const category = CategoryModel.categorize("/home/me/.config/hypr/homegrown.lua")
  assert.strictEqual(category.id, "homegrown")
  assert.strictEqual(category.label, "Homegrown")
})

test("a binding with no source lands in other rather than being dropped", () => {
  assert.strictEqual(CategoryModel.categorize("").id, "other")
  assert.strictEqual(CategoryModel.categorize(undefined).id, "other")
})

test("summarize counts bindings per category, busiest first", () => {
  const summary = CategoryModel.summarize(scanMultifile())
  // Ties keep discovery order -- media is declared before homegrown -- so the
  // panel does not reshuffle its rows between scans.
  assert.deepStrictEqual(summary.map(c => c.id), ["windows", "media", "homegrown"])
  assert.deepStrictEqual(summary.map(c => c.count), [2, 1, 1])
})

test("summarize labels every category", () => {
  const summary = CategoryModel.summarize(scanMultifile())
  assert.strictEqual(summary.find(c => c.id === "windows").label, "Windows")
})

test("categoryOf resolves a binding through its source", () => {
  const bindings = scanMultifile()
  const volume = bindings.find(b => b.description === "Volume up")
  assert.strictEqual(CategoryModel.categoryOf(volume), "media")
})

test("isMuted only silences the categories actually listed", () => {
  assert.strictEqual(CategoryModel.isMuted(["windows"], "windows"), true)
  assert.strictEqual(CategoryModel.isMuted(["windows"], "media"), false)
  assert.strictEqual(CategoryModel.isMuted(null, "windows"), false)
  assert.strictEqual(CategoryModel.isMuted("not-an-array", "windows"), false)
})
