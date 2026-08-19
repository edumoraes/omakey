// Where the hint card sits on screen.
//
// This is arithmetic rather than QML anchors on purpose. The anchor version
// bound each anchor line to a ternary that produced `undefined` for the
// positions that should not use it -- but assigning undefined does not clear an
// anchor. Both members of an axis stayed bound, which sized the card negative
// (so it painted nothing and the hint looked like floating text), and the
// leftover anchors carried over to whichever position was shown next.

var POSITIONS = {
  "top-left": { top: true, side: "left" },
  "top-center": { top: true, side: "center" },
  "top-right": { top: true, side: "right" },
  "bottom-left": { top: false, side: "left" },
  "bottom-center": { top: false, side: "center" },
  "bottom-right": { top: false, side: "right" }
}

var FALLBACK = "bottom-center"

function _clamp(value, limit) {
  if (!(value > 0)) return 0
  return value > limit ? limit : value
}

function origin(position, screenWidth, screenHeight, cardWidth, cardHeight, margin) {
  var spec = POSITIONS[String(position)] || POSITIONS[FALLBACK]
  var gap = Number(margin) || 0

  var x
  if (spec.side === "left") x = gap
  else if (spec.side === "right") x = screenWidth - cardWidth - gap
  else x = (screenWidth - cardWidth) / 2

  var y = spec.top ? gap : screenHeight - cardHeight - gap

  // A card larger than the screen would otherwise start at a negative offset
  // and lose its left edge, which is where the key combo is.
  return { x: _clamp(x, Math.max(0, screenWidth - cardWidth)),
           y: _clamp(y, Math.max(0, screenHeight - cardHeight)) }
}

if (typeof module !== "undefined") module.exports = { origin: origin, POSITIONS: POSITIONS }
