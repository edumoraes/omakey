const { test } = require("node:test")
const assert = require("node:assert")
const Policy = require("../PolicyModel.js")

test("balanced is exactly today's behaviour, so the default changes nothing", () => {
  assert.deepStrictEqual(Policy.configFor("balanced"), Policy.defaults())
})

test("the three presets are ordered from quiet to loud", () => {
  const discreet = Policy.configFor("discreet")
  const balanced = Policy.configFor("balanced")
  const insistent = Policy.configFor("insistent")

  assert.ok(discreet.quietFirst > balanced.quietFirst)
  assert.ok(balanced.quietFirst > insistent.quietFirst)
  assert.ok(discreet.baseIntervalMs > balanced.baseIntervalMs)
  assert.ok(balanced.baseIntervalMs > insistent.baseIntervalMs)
  assert.ok(discreet.giveUpAfter < balanced.giveUpAfter)
  assert.ok(balanced.giveUpAfter < insistent.giveUpAfter)
})

test("an unknown intensity falls back to balanced", () => {
  assert.deepStrictEqual(Policy.configFor("screaming"), Policy.defaults())
  assert.deepStrictEqual(Policy.configFor(undefined), Policy.defaults())
})

// The point of the discreet preset is that it actually shuts up sooner.
test("discreet stays quiet where balanced would have spoken", () => {
  const config = Policy.configFor("discreet")
  let stats = {}
  let last = null
  for (let i = 0; i < 4; i++) {
    last = Policy.recordManual(stats, "close", i * 600000, config)
    stats = last.stats
  }
  assert.strictEqual(last.show, false)
  assert.strictEqual(last.reason, "quiet-start")
})

test("insistent speaks on the second manual use", () => {
  const config = Policy.configFor("insistent")
  let stats = {}
  let last = null
  for (let i = 0; i < 2; i++) {
    last = Policy.recordManual(stats, "close", i * 600000, config)
    stats = last.stats
  }
  assert.strictEqual(last.show, true)
})
