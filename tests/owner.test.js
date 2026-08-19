const { test } = require("node:test")
const assert = require("node:assert")
const Mapper = require("../MapperModel.js")

// The bindings that reach a shared namespace: six panels behind one
// KeyboardPanel surface, and eight menus behind one menu surface.
const BINDINGS = [
  { id: 0, keys: "SUPER + CTRL + A", description: "Audio",
    kind: "exec", arg: "omarchy-shell shell toggle omarchy.audio" },
  { id: 1, keys: "SUPER + CTRL + B", description: "Bluetooth",
    kind: "exec", arg: "omarchy-shell shell toggle omarchy.bluetooth" },
  { id: 2, keys: "SUPER + SPACE", description: "Omarchy menu",
    kind: "exec", arg: "omarchy-menu toggle" },
  { id: 3, keys: "SUPER + ESCAPE", description: "System menu",
    kind: "exec", arg: "omarchy-menu toggle system" },
  { id: 4, keys: "SUPER + SHIFT + code:201", description: "Omarchy menu",
    kind: "exec", arg: "omarchy-menu toggle root" }
]

function layer(namespace, owner) {
  var effect = { name: "openlayer", args: [namespace], at: 1000 }
  if (owner) effect.owner = owner
  return { tier: "B", command: null, effect: effect }
}

// Stands in for the shell's isPluginOpen.
function openOnly() {
  var open = Array.prototype.slice.call(arguments)
  return function (id) { return open.indexOf(id) !== -1 }
}

test("seeds menus by the id the binding names", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(seed.menu["system"], 3)
})

// `omarchy-menu toggle` and `omarchy-menu toggle root` open the same menu, and
// the first binding scanned is the one the user is told about.
test("a bare menu toggle seeds the root menu", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(seed.menu["root"], 2)
})

test("a shared panel namespace resolves through the panel that is open", () => {
  const seed = Mapper.seed(BINDINGS)
  const hit = Mapper.resolve(seed, {}, layer("omarchy-keyboard-panel", "omarchy.bluetooth"))
  assert.strictEqual(hit.bindingId, 1)
  assert.strictEqual(hit.actionKey, "layer:omarchy.bluetooth")
})

test("the menu namespace resolves through the menu that is active", () => {
  const seed = Mapper.seed(BINDINGS)
  const hit = Mapper.resolve(seed, {}, layer("omarchy-menu", "system"))
  assert.strictEqual(hit.bindingId, 3)
  assert.strictEqual(hit.actionKey, "menu:system")
})

// Each menu gets its own schedule, or learning the power menu would silence the
// apps menu.
test("two menus behind one namespace keep separate action keys", () => {
  const seed = Mapper.seed(BINDINGS)
  const system = Mapper.resolve(seed, {}, layer("omarchy-menu", "system"))
  const root = Mapper.resolve(seed, {}, layer("omarchy-menu", "root"))
  assert.notStrictEqual(system.actionKey, root.actionKey)
  assert.notStrictEqual(system.bindingId, root.bindingId)
})

// Silence is still the answer when the shell could not say who opened it: an
// unsampled namespace is exactly the case the ambiguity rule was written for.
test("an ambiguous namespace with no owner stays silent", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(Mapper.resolve(seed, {}, layer("omarchy-menu")), null)
  assert.strictEqual(Mapper.resolve(seed, {}, layer("omarchy-keyboard-panel")), null)
})

test("an owner nothing is bound to stays silent", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(Mapper.resolve(seed, {}, layer("omarchy-menu", "reminder-set")), null)
  assert.strictEqual(Mapper.resolve(seed, {}, layer("omarchy-keyboard-panel", "omarchy.wifi")), null)
})

// The OSD rises on a change no key caused, and a notification arrives on its
// own. Naming an owner for those would be naming a cause that is not there.
test("the OSD and notifications stay refused even with an owner", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(Mapper.resolve(seed, {}, layer("omarchy-osd", "omarchy.audio")), null)
  assert.strictEqual(Mapper.resolve(seed, {}, layer("omarchy-notifications", "omarchy.audio")), null)
})

// Nothing is learned about a shared namespace: the seed answers it exactly, and
// a learned pairing would blame every later click on whichever key fired first.
test("a shared namespace is still never learned", () => {
  const before = { class: {}, layer: {} }
  const after = Mapper.learn(before, 3, { name: "openlayer", args: ["omarchy-menu"] })
  assert.strictEqual(after, before)
})

test("the open panel omakey can name is the one a binding opens", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(Mapper.panelOwner(seed, [], openOnly("omarchy.bluetooth")), "omarchy.bluetooth")
})

// A panel nothing is bound to is not an answer, and the walk must not stop at it.
test("a panel no binding opens is not an owner", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(Mapper.panelOwner(seed, [], openOnly("omarchy.wifi")), "")
  assert.strictEqual(Mapper.panelOwner(seed, [], openOnly("omarchy.wifi", "omarchy.audio")), "omarchy.audio")
})

test("two panels open at once names neither", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(Mapper.panelOwner(seed, [], openOnly("omarchy.audio", "omarchy.bluetooth")), "")
})

test("nothing open is no owner", () => {
  assert.strictEqual(Mapper.panelOwner(Mapper.seed(BINDINGS), [], openOnly()), "")
})

// The sampling plan is the model's to hold: which namespaces are worth asking
// about, and how each one is asked.
test("only a shared namespace carries a sampling plan", () => {
  assert.strictEqual(Mapper.samplingFor("omarchy-keyboard-panel").kind, "panel")
  assert.strictEqual(Mapper.samplingFor("omarchy-clipboard"), null)
  // Sampling these would walk every panel to reach the same refusal.
  assert.strictEqual(Mapper.samplingFor("omarchy-osd"), null)
})

test("the menu plan names where the active menu is read from", () => {
  const plan = Mapper.samplingFor("omarchy-menu")
  assert.strictEqual(plan.kind, "menu")
  assert.strictEqual(plan.pluginId, "omarchy.menu")
  assert.strictEqual(plan.property, "activeMenu")
})

// Told apart so the log can stay quiet about a surface no key opens: the OSD
// promotes on every volume change, and a line each would bury a real fault.
test("a surface no key opens is told apart from a plain miss", () => {
  assert.strictEqual(Mapper.namesNoKey("omarchy-osd"), true)
  assert.strictEqual(Mapper.namesNoKey("omarchy-notifications"), true)
  assert.strictEqual(Mapper.namesNoKey("omarchy-menu"), false)
  assert.strictEqual(Mapper.namesNoKey("omarchy-clipboard"), false)
})

// A panel opened by a command that does not name it -- `omarchy-menu toggle
// reminder-set` raises the reminders panel -- can never be seeded, because
// nothing in the command says which surface it brings up. One keypress pairs
// them, and that is the same bargain openwindow already makes.
test("a keypress teaches which binding opens a sampled panel", () => {
  const before = { class: {}, layer: {}, panel: {} }
  const after = Mapper.learn(before, 7, {
    name: "openlayer", args: ["omarchy-keyboard-panel"], owner: "omarchy.reminders"
  })
  assert.strictEqual(after.panel["omarchy.reminders"], 7)
})

test("what was learned about a panel outranks the seed", () => {
  const seed = Mapper.seed(BINDINGS)
  const learned = { class: {}, layer: {}, panel: { "omarchy.audio": 9 } }
  const hit = Mapper.resolve(seed, learned, layer("omarchy-keyboard-panel", "omarchy.audio"))
  assert.strictEqual(hit.bindingId, 9)
})

test("a learned panel resolves where the seed has nothing", () => {
  const seed = Mapper.seed(BINDINGS)
  const learned = { class: {}, layer: {}, panel: { "omarchy.reminders": 7 } }
  const hit = Mapper.resolve(seed, learned, layer("omarchy-keyboard-panel", "omarchy.reminders"))
  assert.strictEqual(hit.bindingId, 7)
  assert.strictEqual(hit.actionKey, "layer:omarchy.reminders")
})

// The namespace stays unlearnable even now: it is the owner that is unambiguous,
// never the surface they all share.
test("the shared namespace itself is still never learned", () => {
  const before = { class: {}, layer: {}, panel: {} }
  const after = Mapper.learn(before, 7, {
    name: "openlayer", args: ["omarchy-keyboard-panel"], owner: "omarchy.reminders"
  })
  assert.strictEqual(after.layer["omarchy-keyboard-panel"], undefined)
})

test("a sampled namespace with no owner teaches nothing", () => {
  const before = { class: {}, layer: {}, panel: {} }
  assert.strictEqual(Mapper.learn(before, 7, { name: "openlayer", args: ["omarchy-menu"] }), before)
})

// The shell can name panels no binding opens; the walk has to reach them, or a
// keypress could never pair one.
test("a panel the seed never heard of can still be the owner", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(
    Mapper.panelOwner(seed, ["omarchy.reminders"], openOnly("omarchy.reminders")),
    "omarchy.reminders")
})

test("a candidate named twice is asked about once", () => {
  const seed = Mapper.seed(BINDINGS)
  assert.strictEqual(
    Mapper.panelOwner(seed, ["omarchy.audio"], openOnly("omarchy.audio")),
    "omarchy.audio")
})
