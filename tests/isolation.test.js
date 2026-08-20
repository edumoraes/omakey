const { test } = require("node:test")
const assert = require("node:assert")
const { execFileSync, spawnSync } = require("node:child_process")
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

  const shelled = path.join(dir, "created-by-os-execute")
  const piped = path.join(dir, "created-by-io-popen")
  const loaded = path.join(dir, "created-by-loaded-chunk")

  const out = execFileSync("lua", [SCANNER, FIXTURE], {
    encoding: "utf8",
    env: Object.assign({}, process.env, {
      OMAKEY_TEST_CREATE: create,
      OMAKEY_TEST_DELETE: remove,
      OMAKEY_TEST_EXEC: shelled,
      OMAKEY_TEST_POPEN: piped,
      OMAKEY_TEST_LOADED: loaded
    })
  })

  return {
    bindings: RegistryModel.parseRegistry(out), dir: dir, create: create, remove: remove,
    shelled: shelled, piped: piped, loaded: loaded
  }
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

// The reviewer's point, and the one the filesystem shims did not answer: a
// config that shells out does it again on every scan. Refusing os.execute costs
// nothing on a stock Omarchy -- only nvidia.lua shells out at load, and no
// binding depends on it. Bindings gate on cmd_present, which only reads.
test("a scan cannot run a command", () => {
  const result = scanWithSideEffects()
  assert.strictEqual(fs.existsSync(result.shelled), false)
})

test("a scan cannot write through a pipe either", () => {
  const result = scanWithSideEffects()
  assert.strictEqual(fs.existsSync(result.piped), false)
})

// The seam a partial sandbox leaks through: in stock Lua, load() compiles
// against the real globals rather than the caller's environment, so a chunk the
// config builds at runtime would get the unrestricted os back.
test("code the config loads at runtime lands in the same environment", () => {
  const result = scanWithSideEffects()
  assert.strictEqual(fs.existsSync(result.loaded), false)
})

// A config the scanner cannot read has to fail loudly. The sandbox reports an
// unreadable file by returning rather than raising, and an early version of it
// exited 0 on a missing config -- which Registry.qml would have read as a
// config containing no bindings at all.
test("a config that cannot be read fails the scan", () => {
  const result = spawnSync("lua", [SCANNER, path.join(os.tmpdir(), "omakey-no-such-config.lua")],
    { encoding: "utf8" })
  assert.notStrictEqual(result.status, 0)
  assert.match(result.stderr, /scan failed/)
})
