const { test } = require("node:test")
const assert = require("node:assert")
const Toast = require("../ToastModel.js")

// Screen 1920x1080, a 300x80 card, 67px margin.
const S = { w: 1920, h: 1080, cw: 300, ch: 80, m: 67 }
function at(position) {
  return Toast.origin(position, S.w, S.h, S.cw, S.ch, S.m)
}

test("each corner sits inside the screen with its margin", () => {
  assert.deepStrictEqual(at("top-left"), { x: 67, y: 67 })
  assert.deepStrictEqual(at("top-right"), { x: 1920 - 300 - 67, y: 67 })
  assert.deepStrictEqual(at("bottom-left"), { x: 67, y: 1080 - 80 - 67 })
  assert.deepStrictEqual(at("bottom-right"), { x: 1920 - 300 - 67, y: 1080 - 80 - 67 })
})

test("centred positions are centred on the long axis", () => {
  assert.deepStrictEqual(at("top-center"), { x: (1920 - 300) / 2, y: 67 })
  assert.deepStrictEqual(at("bottom-center"), { x: (1920 - 300) / 2, y: 1080 - 80 - 67 })
})

// The anchor-based version left every position partly off-screen or sized
// negative, and the failure depended on which position had been shown before.
// Origins are pure arithmetic precisely so that cannot recur.
test("no position places the card outside the screen", () => {
  const positions = ["top-left", "top-center", "top-right",
                     "bottom-left", "bottom-center", "bottom-right"]
  for (const position of positions) {
    const origin = at(position)
    assert.ok(origin.x >= 0, position + " x is negative")
    assert.ok(origin.y >= 0, position + " y is negative")
    assert.ok(origin.x + S.cw <= S.w, position + " overflows the right edge")
    assert.ok(origin.y + S.ch <= S.h, position + " overflows the bottom edge")
  }
})

test("an unknown position falls back to bottom-center", () => {
  assert.deepStrictEqual(at("middle-of-nowhere"), at("bottom-center"))
  assert.deepStrictEqual(at(""), at("bottom-center"))
})

// A card wider than the screen must still start on screen rather than at a
// negative x, so the combo stays readable.
test("an oversized card is clamped to the screen", () => {
  const origin = Toast.origin("top-right", 400, 300, 900, 200, 67)
  assert.strictEqual(origin.x, 0)
  assert.strictEqual(origin.y, 67)
})
