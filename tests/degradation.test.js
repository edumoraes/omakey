const { test } = require("node:test")
const assert = require("node:assert")
const Policy = require("../PolicyModel.js")

test("effect promotion requires shadow bindings", () => {
  assert.strictEqual(Policy.tiersEnabled({ registry: true, shadows: false, commands: true }).effects, false)
  assert.strictEqual(Policy.tiersEnabled({ registry: true, shadows: false, commands: true }).commands, true)
})

test("nothing is enabled without a registry", () => {
  const tiers = Policy.tiersEnabled({ registry: false, shadows: true, commands: true })
  assert.strictEqual(tiers.effects, false)
  assert.strictEqual(tiers.commands, false)
})

test("everything is enabled when every hook is live", () => {
  const tiers = Policy.tiersEnabled({ registry: true, shadows: true, commands: true })
  assert.strictEqual(tiers.effects, true)
  assert.strictEqual(tiers.commands, true)
})

// Tier A has no in-process hook on this platform: QML refuses to reassign
// Util.execDetached. Spec section 12 question 1 and section 12.1.
test("the shipped capability set has commands off and effects on", () => {
  const tiers = Policy.tiersEnabled({ registry: true, shadows: true, commands: false })
  assert.strictEqual(tiers.effects, true)
  assert.strictEqual(tiers.commands, false)
})

test("a missing capabilities object disables everything rather than assuming", () => {
  const tiers = Policy.tiersEnabled(null)
  assert.strictEqual(tiers.effects, false)
  assert.strictEqual(tiers.commands, false)
})
