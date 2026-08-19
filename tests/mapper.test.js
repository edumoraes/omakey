const { test } = require("node:test")
const assert = require("node:assert")
const Mapper = require("../MapperModel.js")

const BINDINGS = [
  { id: 0, keys: "SUPER + W", key: "W", modmask: 64, description: "Close window",
    kind: "lua", arg: "hl.dsp.window.close()" },
  { id: 1, keys: "SUPER + code:12", key: "code:12", modmask: 64, description: "Switch to workspace 3",
    kind: "lua", arg: 'hl.dsp.focus({ workspace = "3" })' },
  { id: 2, keys: "SUPER + RETURN", key: "RETURN", modmask: 64, description: "Terminal",
    kind: "exec", arg: "omarchy-launch-terminal" },
  { id: 3, keys: "SUPER + CTRL + A", key: "A", modmask: 68, description: "Audio",
    kind: "exec", arg: "omarchy-shell shell toggle omarchy.audio" }
]

test("seeds workspace bindings by number", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(seed.workspace["3"], 1)
})

test("seeds the close binding", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(seed.close, 0)
})

test("seeds exec bindings by command string", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(seed.byCommand["omarchy-launch-terminal"], 2)
})

test("seeds shell panel toggles by plugin id", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(seed.panel["omarchy.audio"], 3)
})

test("resolves a workspace effect to its binding", () => {
  const seed = Mapper.seed(BINDINGS)
  const hit = Mapper.resolve(seed, {}, {
    tier: "B", command: null, effect: { name: "workspacev2", args: ["3", "3"] }
  })
  assert.strictEqual(hit.bindingId, 1)
  assert.strictEqual(hit.actionKey, "workspace:3")
})

test("resolves a captured command to its binding", () => {
  const seed = Mapper.seed(BINDINGS)
  const hit = Mapper.resolve(seed, {}, { tier: "A", command: "omarchy-launch-terminal", effect: null })
  assert.strictEqual(hit.bindingId, 2)
  assert.strictEqual(hit.actionKey, "exec:omarchy-launch-terminal")
})

test("resolves a bar dispatch command through its lua expression", () => {
  const seed = Mapper.seed(BINDINGS)
  const hit = Mapper.resolve(seed, {}, {
    tier: "A", effect: null,
    command: "hyprctl dispatch 'hl.dsp.focus({ workspace = \"3\" })'"
  })
  assert.strictEqual(hit.bindingId, 1)
})

test("returns null when nothing matches", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(Mapper.resolve(seed, {}, {
    tier: "B", command: null, effect: { name: "workspacev2", args: ["9", "9"] }
  }), null)
})

test("prefers a learned mapping over the seed for window classes", () => {
  const seed = Mapper.seed(BINDINGS)
  const learned = { class: { "Alacritty": 2 } }
  const hit = Mapper.resolve(seed, learned, {
    tier: "B", command: null, effect: { name: "openwindow", args: ["0x1", "1", "Alacritty", "term"] }
  })
  assert.strictEqual(hit.bindingId, 2)
  assert.strictEqual(hit.actionKey, "class:Alacritty")
})

// The user's real config carries 21 `hl.dsp.focus({ workspace = ... })`
// bindings and 26 `hl.dsp.window.move({ workspace = ... })` ones. Seeding a
// move as a switch would answer "you could have pressed SUPER SHIFT + 3",
// which moves the window instead of following it -- a wrong answer is worse
// than none.
test("does not seed move-window-to-workspace as a workspace switch", () => {
  const seed = Mapper.seed([
    { id: 0, kind: "lua", arg: 'hl.dsp.window.move({ workspace = "3" })' },
    { id: 1, kind: "lua", arg: 'hl.dsp.window.move({ follow = false, workspace = "4" })' }
  ])
  assert.deepStrictEqual(seed.workspace, {})
})

test("seeds the fullscreen and float toggles the real config uses", () => {
  const seed = Mapper.seed([
    { id: 0, kind: "lua", arg: 'hl.dsp.window.fullscreen({ mode = "fullscreen" })' },
    { id: 1, kind: "lua", arg: 'hl.dsp.window.fullscreen({ mode = "maximized" })' },
    { id: 2, kind: "lua", arg: 'hl.dsp.window.float({ action = "toggle" })' }
  ])
  assert.strictEqual(seed.fullscreen["fullscreen"], 0)
  assert.strictEqual(seed.fullscreen["maximized"], 1)
  assert.strictEqual(seed.floatToggle, 2)
})

test("strips the uwsm-app launcher prefix when seeding a command", () => {
  const seed = Mapper.seed([{ id: 0, kind: "exec", arg: "uwsm-app -- omawrite" }])
  assert.strictEqual(seed.byCommand["omawrite"], 0)
})
