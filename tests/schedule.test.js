const { test } = require("node:test")
const assert = require("node:assert")
const Policy = require("../PolicyModel.js")

const CONFIG = { quietFirst: 0, giveUpAfter: 99, baseIntervalMs: 60000 }

// Getting an action past quiet-start and onto the schedule for the first time.
function firstHint(now) {
  return Policy.recordManual({}, "close", now || 0, CONFIG).stats
}

test("a hint schedules the action one base interval out", () => {
  const stats = firstHint(1000)
  assert.strictEqual(stats.close.intervalMs, CONFIG.baseIntervalMs)
  assert.strictEqual(stats.close.dueAt, 1000 + CONFIG.baseIntervalMs)
})

test("a mouse use before the action comes due says nothing", () => {
  const stats = firstHint(0)
  const early = Policy.recordManual(stats, "close", CONFIG.baseIntervalMs - 1, CONFIG)
  assert.strictEqual(early.show, false)
  assert.strictEqual(early.reason, "scheduled")
})

test("a mouse use once it is due speaks again", () => {
  const stats = firstHint(0)
  assert.strictEqual(Policy.recordManual(stats, "close", CONFIG.baseIntervalMs, CONFIG).show, true)
})

test("each keyboard use pushes the next reminder further out", () => {
  let stats = firstHint(0)
  const intervals = []
  for (let i = 0; i < 4; i++) {
    stats = Policy.recordBind(stats, "close", 1000000 * (i + 1), CONFIG)
    intervals.push(stats.close.intervalMs)
  }
  assert.deepStrictEqual(intervals.slice(0, 2), [CONFIG.baseIntervalMs, CONFIG.baseIntervalMs * 6])
  assert.ok(intervals[2] > intervals[1])
  assert.ok(intervals[3] > intervals[2])
})

test("repeated success raises the ease, so the growth accelerates", () => {
  let stats = firstHint(0)
  for (let i = 0; i < 3; i++) stats = Policy.recordBind(stats, "close", 1000 * (i + 1), CONFIG)
  assert.ok(stats.close.ease > 2.5)
})

test("the interval stops growing at the cap", () => {
  let stats = firstHint(0)
  for (let i = 0; i < 40; i++) stats = Policy.recordBind(stats, "close", 1000 * (i + 1), CONFIG)
  assert.strictEqual(stats.close.intervalMs, Policy.MAX_INTERVAL_MS)
})

// The point of the whole thing: a shortcut the user has been getting right for
// a while stays quiet where a fresh one would have spoken.
test("a well-learned action outlasts a fresh one", () => {
  let stats = firstHint(0)
  for (let i = 0; i < 5; i++) stats = Policy.recordBind(stats, "close", 1000 * (i + 1), CONFIG)
  const eve = stats.close.dueAt - 1
  assert.ok(stats.close.intervalMs > CONFIG.baseIntervalMs * 6)

  const learned = Policy.recordManual(stats, "close", eve, CONFIG)
  assert.strictEqual(learned.show, false)
  assert.strictEqual(learned.reason, "scheduled")
  assert.strictEqual(Policy.recordManual({}, "fresh", eve, CONFIG).show, true)
})

test("falling back to the mouse resets the schedule to the first step", () => {
  let stats = firstHint(0)
  for (let i = 0; i < 4; i++) stats = Policy.recordBind(stats, "close", 1000 * (i + 1), CONFIG)
  const due = stats.close.dueAt
  stats = Policy.recordManual(stats, "close", due, CONFIG).stats
  assert.strictEqual(stats.close.reps, 0)
  assert.strictEqual(stats.close.intervalMs, CONFIG.baseIntervalMs)
})

test("a lapse costs ease, so a shortcut that keeps slipping grows slower", () => {
  let stats = firstHint(0)
  for (let i = 0; i < 2; i++) stats = Policy.recordBind(stats, "close", 1000 * (i + 1), CONFIG)
  const before = stats.close.ease
  stats = Policy.recordManual(stats, "close", stats.close.dueAt, CONFIG).stats
  assert.ok(stats.close.ease < before)
})

test("the ease never falls below the SM-2 floor", () => {
  let stats = firstHint(0)
  let now = 0
  for (let i = 0; i < 20; i++) {
    stats = Policy.recordBind(stats, "close", now, CONFIG)
    now = stats.close.dueAt
    stats = Policy.recordManual(stats, "close", now, CONFIG).stats
    now += CONFIG.baseIntervalMs
  }
  assert.ok(stats.close.ease >= Policy.EASE_MIN)
})

// The first hint of an action's life is not a lapse -- there was nothing to
// forget yet, so it must not start the user off with a penalised ease.
test("the first hint does not penalise an action that never succeeded", () => {
  const stats = firstHint(0)
  assert.strictEqual(stats.close.ease, Policy.EASE_START)
})

// The panel counts what the reset would throw away, and a muted action is part
// of that: the reset clears it too.
test("every scheduled action counts as tracked, muted ones included", () => {
  let stats = Policy.recordManual({}, "close", 0, CONFIG).stats
  stats = Policy.recordManual(stats, "workspace:3", 0, CONFIG).stats
  stats = Policy.mute(stats, "close")
  assert.strictEqual(Policy.trackedCount(stats), 2)
  assert.strictEqual(Policy.trackedCount(null), 0)
})

test("the learning count reads as a sentence, singular included", () => {
  assert.strictEqual(Policy.learningLabel(0), "Nothing learned yet")
  assert.strictEqual(Policy.learningLabel(1), "1 shortcut being tracked")
  assert.strictEqual(Policy.learningLabel(12), "12 shortcuts being tracked")
})
