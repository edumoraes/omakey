const { test } = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")
const Correlator = require("../CorrelatorModel.js")

const CONFIG = { graceMs: 150 }
const effect = (name, args, at) => ({ name, args, at })
const shadow = (id, at) => ({ name: "custom", args: ["omakey", String(id)], at })

test("an effect with no shadow is promoted after the grace window", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.ingest(state, effect("workspacev2", ["3", "3"], 1000))
  assert.deepStrictEqual(Correlator.flush(state, 1100), [])
  const out = Correlator.flush(state, 1200)
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].effect.name, "workspacev2")
  assert.strictEqual(out[0].tier, "B")
})

test("a shadow arriving after the effect suppresses it", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.ingest(state, effect("workspacev2", ["3", "3"], 1000))
  Correlator.ingest(state, shadow(42, 1005))
  assert.deepStrictEqual(Correlator.flush(state, 1200), [])
})

test("a shadow arriving before the effect suppresses it too", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.ingest(state, shadow(42, 1000))
  Correlator.ingest(state, effect("workspacev2", ["3", "3"], 1005))
  assert.deepStrictEqual(Correlator.flush(state, 1200), [])
})

test("a shadow older than the grace window does not suppress", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.ingest(state, shadow(42, 500))
  Correlator.ingest(state, effect("workspacev2", ["3", "3"], 1000))
  assert.strictEqual(Correlator.flush(state, 1200).length, 1)
})

test("a command promotes immediately at tier A and suppresses the effect", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.command(state, "omarchy-capture-screenshot", 1000)
  Correlator.ingest(state, effect("workspacev2", ["3", "3"], 1005))
  const out = Correlator.flush(state, 1200)
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].tier, "A")
  assert.strictEqual(out[0].command, "omarchy-capture-screenshot")
})

test("a command still suppresses an effect that lands after a flush tick", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.command(state, "omarchy-capture-screenshot", 1000)
  assert.strictEqual(Correlator.flush(state, 1010).length, 1)   // drains ready
  Correlator.ingest(state, effect("workspacev2", ["3", "3"], 1060))
  assert.deepStrictEqual(Correlator.flush(state, 1300), [])
})

test("cursor transitions are recorded, not promoted", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:moving"], at: 1000 })
  assert.deepStrictEqual(Correlator.flush(state, 1200), [])
  assert.strictEqual(state.cursorMovingAt, 1000)
})

test("events outside the effect map are ignored", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.ingest(state, effect("activelayout", ["kbd", "us"], 1000))
  assert.deepStrictEqual(Correlator.flush(state, 1200), [])
})

test("window close is tier C", () => {
  assert.strictEqual(Correlator.EFFECTS["closewindow"], "C")

  // Classification alone no longer promotes it: tier C is gated on the cursor,
  // which the tests further down cover. With the gate satisfied it comes
  // through carrying its tier.
  const state = Correlator.createState({ graceMs: 150, cursorIdleMs: 800 })
  Correlator.setGeometry(state, "0x1", { x: 0, y: 0, width: 100, height: 100 })
  state.cursorAt = { x: 50, y: 50 }
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:moving"], at: 950 })
  Correlator.ingest(state, effect("closewindow", ["0x1"], 1000))
  assert.strictEqual(Correlator.flush(state, 1200)[0].tier, "C")
})

test("omakey's own layer surface is never promoted", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.ingest(state, effect("openlayer", ["omakey-toast"], 1000))
  assert.deepStrictEqual(Correlator.flush(state, 1200), [])
})

// The shadow leads the effect: measured at 309 ms for an exec binding, because
// the gap is the spawned process starting. See spec section 12 question 3.
const SPLIT = { graceMs: 150, shadowMs: 600 }

test("shadowMs suppresses an effect the shadow leads by more than graceMs", () => {
  const state = Correlator.createState(SPLIT)
  Correlator.ingest(state, shadow(139, 1000))
  Correlator.ingest(state, effect("openlayer", ["omarchy-menu"], 1309))
  assert.deepStrictEqual(Correlator.flush(state, 1600), [])
})

test("a shadow leading by more than shadowMs still does not suppress", () => {
  const state = Correlator.createState(SPLIT)
  Correlator.ingest(state, shadow(139, 1000))
  Correlator.ingest(state, effect("openlayer", ["omarchy-menu"], 1700))
  assert.strictEqual(Correlator.flush(state, 2000).length, 1)
})

test("shadowMs does not delay promotion: the hold stays graceMs", () => {
  const state = Correlator.createState(SPLIT)
  Correlator.ingest(state, effect("workspacev2", ["3", "3"], 1000))
  assert.strictEqual(Correlator.flush(state, 1151).length, 1)
})

test("shadowMs defaults to graceMs so a lone grace window stays symmetric", () => {
  const state = Correlator.createState({ graceMs: 150 })
  assert.strictEqual(state.shadowMs, 150)
})

// Replay of a stream recorded off the live compositor. The header of the
// fixture names which actions were keyboard-driven and which were not.
function fixture() {
  const file = path.join(__dirname, "fixtures", "stream-mixed.jsonl")
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(line => line.trim() && line[0] !== "#")
    .map(line => JSON.parse(line))
}

function replay(config) {
  const state = Correlator.createState(config)
  const events = fixture()
  const out = []
  for (const parsed of events) {
    // Emulate the service's 50 ms flush tick: time only ever advances to the
    // next event, so `lastShadowAt` is the one contemporaneous with it.
    out.push(...Correlator.flush(state, parsed.at))
    Correlator.ingest(state, parsed)
  }
  const last = events[events.length - 1].at
  out.push(...Correlator.flush(state, last + config.graceMs + 1))
  return out
}

test("replaying the recorded stream promotes only the mouse-driven actions", () => {
  const out = replay(SPLIT)
  assert.deepStrictEqual(
    out.map(p => p.effect.name + " @" + p.effect.at),
    [
      "openlayer @1787161716338",   // mouse: menu command run directly
      "workspacev2 @1787161722237", // mouse: dispatched workspace switch
      "workspacev2 @1787161724245"  // mouse: dispatched back again
    ]
  )
  assert.ok(out.every(p => p.tier === "B"))
})

test("the recorded keyboard menu open is the case a symmetric window loses", () => {
  const symmetric = replay({ graceMs: 150, shadowMs: 150 })
  const leaked = symmetric.filter(p => p.effect.at === 1787161710401)
  assert.strictEqual(leaked.length, 1, "a 150 ms symmetric window promotes the keyboard open")
  assert.strictEqual(replay(SPLIT).filter(p => p.effect.at === 1787161710401).length, 0)
})

// A suppressed effect is the one case where being suppressed is still useful:
// the keyboard caused it, so the binding that fired is the binding that
// produces this effect. That is the only way an exec binding is ever mapped.
test("an effect suppressed by a leading shadow is reported as a lesson", () => {
  const state = Correlator.createState(SPLIT)
  Correlator.ingest(state, shadow(139, 1000))
  const opened = effect("openlayer", ["omarchy-menu"], 1309)
  Correlator.ingest(state, opened)
  Correlator.flush(state, 1600)
  assert.deepStrictEqual(Correlator.drainSuppressions(state), [{ bindingId: 139, effect: opened }])
})

test("an effect suppressed by a trailing shadow is reported too", () => {
  const state = Correlator.createState(CONFIG)
  const opened = effect("openwindow", ["0x1", "1", "Alacritty", "term"], 1000)
  Correlator.ingest(state, opened)
  Correlator.ingest(state, shadow(7, 1005))
  assert.deepStrictEqual(Correlator.drainSuppressions(state), [{ bindingId: 7, effect: opened }])
})

test("draining clears the lessons", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.ingest(state, effect("openwindow", ["0x1", "1", "A", "t"], 1000))
  Correlator.ingest(state, shadow(7, 1005))
  Correlator.drainSuppressions(state)
  assert.deepStrictEqual(Correlator.drainSuppressions(state), [])
})

test("a promoted effect produces no lesson", () => {
  const state = Correlator.createState(CONFIG)
  Correlator.ingest(state, effect("workspacev2", ["3", "3"], 1000))
  Correlator.flush(state, 1200)
  assert.deepStrictEqual(Correlator.drainSuppressions(state), [])
})

// Tier C is the noisy tier: a window closing is usually the application's own
// Ctrl+W, not a click on a titlebar button. The brake is the cursor -- it has
// to have moved recently, and for a close it has to have been over the window
// that closed. Spec section 9: when the gate cannot judge, it suppresses.
const GATED = { graceMs: 150, cursorIdleMs: 800 }

test("tier C is suppressed when the cursor has been idle", () => {
  const state = Correlator.createState(GATED)
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:idle"], at: 0 })
  Correlator.setGeometry(state, "0x1", { x: 0, y: 0, width: 100, height: 100 })
  Correlator.ingest(state, effect("closewindow", ["0x1"], 5000))
  assert.deepStrictEqual(Correlator.flush(state, 5200), [])
})

test("tier C passes when the cursor moved recently inside the window", () => {
  const state = Correlator.createState(GATED)
  Correlator.setGeometry(state, "0x1", { x: 0, y: 0, width: 100, height: 100 })
  state.cursorAt = { x: 50, y: 50 }
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:moving"], at: 4800 })
  Correlator.ingest(state, effect("closewindow", ["0x1"], 5000))
  assert.strictEqual(Correlator.flush(state, 5200).length, 1)
})

test("tier C is suppressed when the cursor is outside the closed window", () => {
  const state = Correlator.createState(GATED)
  Correlator.setGeometry(state, "0x1", { x: 0, y: 0, width: 100, height: 100 })
  state.cursorAt = { x: 900, y: 900 }
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:moving"], at: 4800 })
  Correlator.ingest(state, effect("closewindow", ["0x1"], 5000))
  assert.deepStrictEqual(Correlator.flush(state, 5200), [])
})

test("tier B is not gated on the cursor", () => {
  const state = Correlator.createState(GATED)
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:idle"], at: 0 })
  Correlator.ingest(state, effect("workspacev2", ["3", "3"], 5000))
  assert.strictEqual(Correlator.flush(state, 5200).length, 1)
})

test("a close with no known geometry is suppressed rather than guessed at", () => {
  const state = Correlator.createState(GATED)
  state.cursorAt = { x: 50, y: 50 }
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:moving"], at: 4800 })
  Correlator.ingest(state, effect("closewindow", ["0xdead"], 5000))
  assert.deepStrictEqual(Correlator.flush(state, 5200), [])
})

// Hyprland reports window addresses bare on socket2 ("55ba0ae078a0") and
// prefixed through hyprctl ("0x55ba0ae078a0"). Storing one and looking up the
// other would leave every geometry permanently unknown, which the gate reads
// as "suppress" -- tier C would go silently dead.
test("geometry matches whether or not the address carries an 0x prefix", () => {
  const state = Correlator.createState(GATED)
  Correlator.setGeometry(state, "0x55ba0ae078a0", { x: 0, y: 0, width: 100, height: 100 })
  state.cursorAt = { x: 50, y: 50 }
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:moving"], at: 4800 })
  Correlator.ingest(state, effect("closewindow", ["55ba0ae078a0"], 5000))
  assert.strictEqual(Correlator.flush(state, 5200).length, 1)
})

test("the cursor payload carries the position it was read at", () => {
  const state = Correlator.createState(GATED)
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:moving:1014:552"], at: 1000 })
  assert.strictEqual(state.cursorMovingAt, 1000)
  assert.deepStrictEqual(state.cursorAt, { x: 1014, y: 552 })
})

test("a tier C effect other than close needs only recent cursor movement", () => {
  const state = Correlator.createState(GATED)
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:moving"], at: 4800 })
  Correlator.ingest(state, effect("fullscreen", ["1"], 5000))
  assert.strictEqual(Correlator.flush(state, 5200).length, 1)
})

test("geometry is taken from the shape hyprctl clients reports", () => {
  const state = Correlator.createState(GATED)
  Correlator.setGeometryFromClients(state, [
    { address: "0x55ba0916cd10", at: [12, 38], size: [1896, 1030] },
    { address: "0xdeadbeef", at: [0, 0], size: [10, 10] }
  ])
  state.cursorAt = { x: 900, y: 500 }
  Correlator.ingest(state, { name: "custom", args: ["omakey", "cursor:moving"], at: 4800 })
  Correlator.ingest(state, effect("closewindow", ["55ba0916cd10"], 5000))
  assert.strictEqual(Correlator.flush(state, 5200).length, 1)
})

test("a client with no usable geometry is skipped rather than stored as zero", () => {
  const state = Correlator.createState(GATED)
  Correlator.setGeometryFromClients(state, [{ address: "0x1" }, null])
  assert.deepStrictEqual(state.geometry, {})
})
