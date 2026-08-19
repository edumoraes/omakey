const { test } = require("node:test")
const assert = require("node:assert")
const { execFileSync } = require("node:child_process")
const path = require("node:path")
const RegistryModel = require("../RegistryModel.js")

const FIXTURE = path.join(__dirname, "fixtures", "hyprland.lua")
const SCANNER = path.join(__dirname, "..", "lua", "registry.lua")

function scan() {
  return execFileSync("lua", [SCANNER, FIXTURE], { encoding: "utf8" })
}

test("scanner emits one record per binding", () => {
  const bindings = RegistryModel.parseRegistry(scan())
  assert.strictEqual(bindings.length, 5)
})

test("scanner keeps the raw keys string for re-binding", () => {
  const bindings = RegistryModel.parseRegistry(scan())
  const workspace = bindings.find(b => b.description === "Switch to workspace 3")
  assert.strictEqual(workspace.keys, "SUPER + code:12")
  assert.strictEqual(workspace.modmask, 64)
  assert.strictEqual(workspace.key, "code:12")
})

test("scanner distinguishes exec from lua dispatchers", () => {
  const bindings = RegistryModel.parseRegistry(scan())
  const terminal = bindings.find(b => b.description === "Terminal")
  assert.strictEqual(terminal.kind, "exec")
  assert.strictEqual(terminal.arg, "omarchy-launch-terminal")

  const close = bindings.find(b => b.description === "Close window")
  assert.strictEqual(close.kind, "lua")
  assert.strictEqual(close.arg, "hl.dsp.window.close()")
})

test("scanner keeps descriptionless bindings", () => {
  const bindings = RegistryModel.parseRegistry(scan())
  const bare = bindings.find(b => b.keys === "SUPER + Q")
  assert.ok(bare)
  assert.strictEqual(bare.description, "")
})

test("comboLabel renders modifiers and keys", () => {
  assert.strictEqual(
    RegistryModel.comboLabel({ modmask: 65, key: "TAB" }),
    "SUPER SHIFT + TAB"
  )
})

test("parseRegistry skips malformed lines instead of throwing", () => {
  const bindings = RegistryModel.parseRegistry("garbage\n\nSUPER + A\t64\tA\tDesc\texec\tcmd\n")
  assert.strictEqual(bindings.length, 1)
  assert.strictEqual(bindings[0].id, 0)
})
