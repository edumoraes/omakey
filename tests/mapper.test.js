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

test("learns a window class from a shadowed open", () => {
  const learned = Mapper.learn({}, 2, { name: "openwindow", args: ["0x1", "1", "Alacritty", "term"] })
  assert.strictEqual(learned.class["Alacritty"], 2)
})

// A third-party panel, because it is the case learning still has to cover:
// Omarchy's own panels either resolve from the seed or share one namespace.
test("learns a layer namespace from a shadowed open", () => {
  const learned = Mapper.learn({}, 3, { name: "openlayer", args: ["now-playing"] })
  assert.strictEqual(learned.layer["now-playing"], 3)
})

test("learning does not mutate the input", () => {
  const before = {}
  Mapper.learn(before, 2, { name: "openwindow", args: ["0x1", "1", "Alacritty", "t"] })
  assert.deepStrictEqual(before, {})
})

test("ignores effects that carry no learnable identity", () => {
  const learned = Mapper.learn({}, 2, { name: "closewindow", args: ["0x1"] })
  assert.deepStrictEqual(learned, {})
})

const SPECIAL = BINDINGS.concat([
  { id: 4, keys: "SUPER + S", key: "S", modmask: 64, description: "Toggle scratchpad",
    kind: "lua", arg: 'hl.dsp.workspace.toggle_special("scratchpad")' }
])

test("seeds special workspaces by name", () => {
  const seed = Mapper.seed(SPECIAL)
  assert.strictEqual(seed.special["scratchpad"], 4)
})

// Hyprland reports `activespecial>>special:scratchpad,eDP-1`, while the binding
// names the workspace bare. Verified against Hyprland 0.56.2 on 2026-08-19.
test("resolves an activespecial effect to its toggle binding", () => {
  const seed = Mapper.seed(SPECIAL)
  const hit = Mapper.resolve(seed, {}, {
    tier: "B", command: null,
    effect: { name: "activespecial", args: ["special:scratchpad", "eDP-1"] }
  })
  assert.strictEqual(hit.bindingId, 4)
  assert.strictEqual(hit.actionKey, "special:scratchpad")
})

// Leaving a special workspace emits `activespecial>>,eDP-1` -- the name is gone,
// so there is nothing to attribute the change to.
test("ignores an activespecial effect that names no workspace", () => {
  const seed = Mapper.seed(SPECIAL)
  assert.strictEqual(Mapper.resolve(seed, {}, {
    tier: "B", command: null, effect: { name: "activespecial", args: ["", "eDP-1"] }
  }), null)
})

// The panel seed already holds `omarchy.clipboard` -> binding; the namespace on
// socket2 is `omarchy-clipboard`. Bridging the two means a first click is
// promoted, instead of waiting for a keypress to teach the mapping.
test("resolves a panel layer from the seed without learning it first", () => {
  const seed = Mapper.seed([{ id: 7, kind: "exec", arg: "omarchy-shell shell toggle omarchy.clipboard" }])
  const hit = Mapper.resolve(seed, {}, {
    tier: "B", command: null, effect: { name: "openlayer", args: ["omarchy-clipboard"] }
  })
  assert.strictEqual(hit.bindingId, 7)
  assert.strictEqual(hit.actionKey, "layer:omarchy-clipboard")
})

// All six bar panels open through qs.Ui/KeyboardPanel and share one namespace,
// so the event cannot say which panel opened. Verified on 2026-08-19: clicking
// the audio widget emitted `openlayer>>omarchy-keyboard-panel`.
test("never resolves the shared keyboard-panel namespace", () => {
  const seed = Mapper.seed(BINDINGS)
  const learned = { layer: { "omarchy-keyboard-panel": 3 } }
  assert.strictEqual(Mapper.resolve(seed, learned, {
    tier: "B", command: null, effect: { name: "openlayer", args: ["omarchy-keyboard-panel"] }
  }), null)
})

test("never learns the shared keyboard-panel namespace", () => {
  const learned = Mapper.learn({}, 3, { name: "openlayer", args: ["omarchy-keyboard-panel"] })
  assert.strictEqual((learned.layer || {})["omarchy-keyboard-panel"], undefined)
})

// Verified on 2026-08-19: `omarchy-menu toggle apps` and `... toggle system`
// both emitted `openlayer>>omarchy-menu`, and eight bindings open that menu.
test("never resolves the shared menu namespace", () => {
  const learned = { layer: { "omarchy-menu": 3 } }
  assert.strictEqual(Mapper.resolve(Mapper.seed(BINDINGS), learned, {
    tier: "B", command: null, effect: { name: "openlayer", args: ["omarchy-menu"] }
  }), null)
})

// A namespace learned before it was known to be ambiguous is dead weight that
// copies forward on every later learn. Dropping it on the way through means the
// state file heals itself instead of carrying the bad pairing indefinitely.
test("drops an ambiguous namespace already in the learned state", () => {
  const stale = { layer: { "omarchy-menu": 3, "now-playing": 5 } }
  const learned = Mapper.learn(stale, 9, { name: "openlayer", args: ["omarchy-emojis"] })
  assert.strictEqual(learned.layer["omarchy-menu"], undefined)
  assert.strictEqual(learned.layer["now-playing"], 5)
})
