const { test } = require("node:test")
const assert = require("node:assert")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const RegistryModel = require("../RegistryModel.js")

const FIXTURE = path.join(__dirname, "fixtures", "side-effects.lua")
const SCANNER = path.join(__dirname, "..", "lua", "registry.lua")

// The config is the user's own and Hyprland already runs it, so the danger is
// not what it contains -- it is that a scan runs it a second time, outside the
// compositor, on every reload. A scan has to be able to read the config and be
// unable to change anything.
function scanWithSideEffects() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omakey-isolation-"))
  const create = path.join(dir, "created-by-the-scan")
  const remove = path.join(dir, "must-survive")
  fs.writeFileSync(remove, "still here\n")

  const out = execFileSync("lua", [SCANNER, FIXTURE], {
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      OMAKEY_TEST_CREATE: create,
      OMAKEY_TEST_DELETE: remove
    })
  })

  return { bindings: RegistryModel.parseRegistry(out), dir: dir, create: create, remove: remove }
}

test("a scan cannot create a file", () => {
  const result = scanWithSideEffects()
  assert.strictEqual(fs.existsSync(result.create), false)
})

test("a scan cannot delete or rename a file", () => {
  const result = scanWithSideEffects()
  assert.strictEqual(fs.existsSync(result.remove), true)
  assert.strictEqual(fs.readFileSync(result.remove, "utf8"), "still here\n")
})

// Blocking writes must not cost the scan its reads. Omarchy's own config walks
// three directories before it declares a binding, so a scanner that cannot read
// returns nothing at all and the plugin goes silent on a stock install.
test("a scan can still read a file", () => {
  const result = scanWithSideEffects()
  assert.strictEqual(result.bindings[0].description, "Probe still here")
})

// A blocked write is not a scan failure. The config keeps loading, and the
// bindings declared after the write it did not get are still reported.
test("a blocked write does not abort the scan", () => {
  const result = scanWithSideEffects()
  assert.strictEqual(result.bindings.length, 1)
  assert.strictEqual(result.bindings[0].kind, "exec")
})
