const { test } = require("node:test")
const assert = require("node:assert")
const PayloadModel = require("../PayloadModel.js")

const BINDINGS = [
  { id: 0, keys: "SUPER + W" },
  { id: 1, keys: "SUPER + code:12" },
  { id: 2, keys: 'SUPER + "odd"' }
]

test("emits one hl.bind per binding, with the event id", () => {
  const lua = PayloadModel.buildChunks(BINDINGS, 10).join("\n")
  assert.match(lua, /hl\.bind\("SUPER \+ W", hl\.dsp\.event\("omakey,0"\), \{\}\)/)
  assert.match(lua, /hl\.bind\("SUPER \+ code:12", hl\.dsp\.event\("omakey,1"\), \{\}\)/)
})

test("never emits a description", () => {
  const lua = PayloadModel.buildChunks(BINDINGS, 10).join("\n")
  assert.ok(!/description/.test(lua))
})

test("escapes quotes and backslashes in keys", () => {
  const lua = PayloadModel.buildChunks(BINDINGS, 10).join("\n")
  assert.match(lua, /hl\.bind\("SUPER \+ \\"odd\\""/)
})

test("splits into chunks of the requested size", () => {
  const chunks = PayloadModel.buildChunks(BINDINGS, 2)
  assert.strictEqual(chunks.length, 2)
})

test("skips bindings with an empty keys string", () => {
  const lua = PayloadModel.buildChunks([{ id: 0, keys: "" }], 10).join("\n")
  assert.strictEqual(lua.indexOf("hl.bind"), -1)
})
