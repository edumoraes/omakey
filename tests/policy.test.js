const { test } = require("node:test")
const assert = require("node:assert")
const Policy = require("../PolicyModel.js")

const CONFIG = { quietFirst: 3, giveUpAfter: 5, baseIntervalMs: 60000 }

function manualTimes(count, startAt) {
  let stats = {}
  let last = null
  for (let i = 0; i < count; i++) {
    last = Policy.recordManual(stats, "close", (startAt || 0) + i * 120000, CONFIG)
    stats = last.stats
  }
  return { stats, last }
}

test("stays quiet for the first quietFirst occurrences", () => {
  const { last } = manualTimes(3)
  assert.strictEqual(last.show, false)
  assert.strictEqual(last.reason, "quiet-start")
})

test("shows on the occurrence after quietFirst", () => {
  const { last } = manualTimes(4)
  assert.strictEqual(last.show, true)
})

test("stays quiet until the action comes due again", () => {
  let { stats } = manualTimes(4)
  const soon = Policy.recordManual(stats, "close", 3 * 120000 + 1000, CONFIG)
  assert.strictEqual(soon.show, false)
  assert.strictEqual(soon.reason, "scheduled")
})

// Adoption used to silence an action for good once it crossed a counter. It is
// the schedule that decides now, and the schedule never quite stops -- but a
// handful of successes already push the next reminder past any single sitting.
test("using the binding pushes the next reminder well past the first step", () => {
  let { stats } = manualTimes(4)
  for (let i = 0; i < 5; i++) stats = Policy.recordBind(stats, "close", 900000 + i, CONFIG)
  const after = Policy.recordManual(stats, "close", 2000000, CONFIG)
  assert.strictEqual(after.show, false)
  assert.strictEqual(after.reason, "scheduled")
})

test("self-demotes after giveUpAfter hints with no adoption", () => {
  let stats = {}
  let result = null
  for (let i = 0; i < 40; i++) {
    result = Policy.recordManual(stats, "close", i * 120000, CONFIG)
    stats = result.stats
  }
  assert.strictEqual(stats.close.muted, true)
  assert.strictEqual(result.show, false)
  assert.strictEqual(result.reason, "gave-up")
})

test("adopting the binding once resets the give-up counter", () => {
  let { stats } = manualTimes(4)
  stats = Policy.recordBind(stats, "close", 500000, CONFIG)
  assert.strictEqual(stats.close.hintCount, 0)
})

test("an explicitly muted action never shows again", () => {
  let { stats } = manualTimes(4)
  stats = Policy.mute(stats, "close")
  const after = Policy.recordManual(stats, "close", 9999999, CONFIG)
  assert.strictEqual(after.show, false)
  assert.strictEqual(after.reason, "muted")
})

test("actions are counted independently", () => {
  let { stats } = manualTimes(4)
  const other = Policy.recordManual(stats, "workspace:3", 500000, CONFIG)
  assert.strictEqual(other.show, false)
  assert.strictEqual(other.reason, "quiet-start")
})

// The two silences mean different things and a bug report needs to tell them
// apart: "muted" is the user's decision, "gave-up" is omakey judging its own
// precision and standing down.
test("a self-demoted action keeps reporting gave-up, not muted", () => {
  let stats = {}
  for (let i = 0; i < 40; i++) stats = Policy.recordManual(stats, "close", i * 120000, CONFIG).stats
  assert.strictEqual(Policy.recordManual(stats, "close", 9999999, CONFIG).reason, "gave-up")
})

test("a user mute outranks a self-demotion already in place", () => {
  let stats = {}
  for (let i = 0; i < 40; i++) stats = Policy.recordManual(stats, "close", i * 120000, CONFIG).stats
  stats = Policy.mute(stats, "close")
  assert.strictEqual(Policy.recordManual(stats, "close", 9999999, CONFIG).reason, "muted")
})

test("recording a manual use does not mutate the stats it was given", () => {
  const before = {}
  Policy.recordManual(before, "close", 1000, CONFIG)
  assert.deepStrictEqual(before, {})
})
