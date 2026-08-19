// Decides whether the user should actually be told. A Key Promoter's failure
// mode is being uninstalled for nagging, so every rule here exists to say less.
//
// When to speak again is SM-2, the scheduler behind Anki, with the cards taken
// out. An action the user performs with the keyboard is a successful review and
// its next reminder moves further out; falling back to the mouse once the
// action is due is a lapse and drops it to the first step again. Nothing here
// is asked of the user: the "grade" is which input device they reached for.

var EASE_START = 2.5
var EASE_MIN = 1.3
// SM-2's q=5 and q=2 through EF += 0.1 - (5-q)*(0.08 + (5-q)*0.02). The user
// never grades, so the two outcomes we can observe are pinned to those grades.
var EASE_SUCCESS = 0.1
var EASE_LAPSE = 0.32
// I(2) = I(1) * 6 in SM-2, before the ease takes over from I(3).
var SECOND_STEP = 6
var MAX_INTERVAL_MS = 30 * 24 * 3600000

// One knob instead of four. A user who wants fewer hints wants a longer first
// interval *and* an earlier give-up; asking them to reason about the counters
// separately is asking them to reason about the correlator.
//
// baseIntervalMs is I(1): the whole schedule is built out of it, so the
// intensity keeps meaning what it meant even though the spacing now grows.
var PRESETS = {
  discreet: { quietFirst: 6, giveUpAfter: 3, baseIntervalMs: 300000 },
  balanced: { quietFirst: 3, giveUpAfter: 5, baseIntervalMs: 60000 },
  insistent: { quietFirst: 1, giveUpAfter: 10, baseIntervalMs: 15000 }
}

function _copy(config) {
  return { quietFirst: config.quietFirst, giveUpAfter: config.giveUpAfter,
           baseIntervalMs: config.baseIntervalMs }
}

function defaults() {
  return _copy(PRESETS.balanced)
}

function configFor(intensity) {
  var preset = PRESETS[String(intensity)]
  return _copy(preset || PRESETS.balanced)
}

function _entry(stats, key) {
  var existing = stats[key]
  return {
    manualCount: (existing && existing.manualCount) || 0,
    bindCount: (existing && existing.bindCount) || 0,
    hintCount: (existing && existing.hintCount) || 0,
    // The SM-2 state. reps is the run of successes since the last lapse, not
    // the lifetime count -- that is bindCount.
    reps: (existing && existing.reps) || 0,
    ease: (existing && existing.ease) || EASE_START,
    intervalMs: (existing && existing.intervalMs) || 0,
    // -1 is "never scheduled", which is what lets the very first hint through
    // without a special case at the call site.
    dueAt: (existing && typeof existing.dueAt === "number") ? existing.dueAt : -1,
    muted: !!(existing && existing.muted),
    // "self" is omakey standing down, "user" is the user's decision. Both are
    // silent; only one of them is omakey's fault, and a bug report needs to
    // tell them apart.
    mutedBy: (existing && existing.mutedBy) || ""
  }
}

function _with(stats, key, entry) {
  var next = {}
  for (var existing in stats) next[existing] = stats[existing]
  next[key] = entry
  return next
}

// SM-2 floors the ease and leaves it unbounded above, which is safe here
// because MAX_INTERVAL_MS is what actually stops the growth.
function _clampEase(ease) {
  return ease < EASE_MIN ? EASE_MIN : ease
}

// SM-2's I(n): the first two steps are fixed, the rest is the ease compounding.
function _nextInterval(entry, base) {
  if (entry.reps <= 1) return base
  if (entry.reps === 2) return base * SECOND_STEP
  var grown = Math.round(entry.intervalMs * entry.ease)
  return grown > MAX_INTERVAL_MS ? MAX_INTERVAL_MS : grown
}

function _schedule(entry, now, interval) {
  entry.intervalMs = interval
  entry.dueAt = now + interval
}

function recordManual(stats, key, now, config) {
  var settings = config || defaults()
  var entry = _entry(stats || {}, key)
  entry.manualCount += 1

  var reason = ""
  if (entry.muted) reason = entry.mutedBy === "self" ? "gave-up" : "muted"
  else if (entry.manualCount <= settings.quietFirst) reason = "quiet-start"
  else if (entry.dueAt >= 0 && now < entry.dueAt) reason = "scheduled"

  if (reason) return { stats: _with(stats || {}, key, entry), show: false, reason: reason }

  entry.hintCount += 1

  // The lapse. An action with no successes behind it has nothing to forget, so
  // it is scheduled without being charged the ease penalty -- otherwise the
  // very first hint would hand the user a shortcut that is already discounted.
  if (entry.reps > 0) entry.ease = _clampEase(entry.ease - EASE_LAPSE)
  entry.reps = 0
  _schedule(entry, now, settings.baseIntervalMs)

  // Self-demotion: the plugin measures its own precision. A hint shown
  // giveUpAfter times that the user never adopted is either mapped to the wrong
  // binding or unwanted. Either way, stop.
  if (entry.hintCount >= settings.giveUpAfter && entry.bindCount === 0) {
    entry.muted = true
    entry.mutedBy = "self"
    return { stats: _with(stats || {}, key, entry), show: false, reason: "gave-up" }
  }

  return { stats: _with(stats || {}, key, entry), show: true, reason: "hint" }
}

// The successful review. Using the keyboard is the only evidence omakey ever
// gets that the user knows the binding, so it is both the adoption signal and
// the grade.
function recordBind(stats, key, now, config) {
  var settings = config || defaults()
  var entry = _entry(stats || {}, key)
  entry.bindCount += 1
  entry.hintCount = 0
  entry.reps += 1
  entry.ease = _clampEase(entry.ease + EASE_SUCCESS)
  _schedule(entry, now, _nextInterval(entry, settings.baseIntervalMs))
  return _with(stats || {}, key, entry)
}

function mute(stats, key) {
  var entry = _entry(stats || {}, key)
  entry.muted = true
  entry.mutedBy = "user"
  return _with(stats || {}, key, entry)
}

// What the reset button is offering to discard. Counting the keys is trivial;
// what is not is that "tracked" means every action omakey holds a schedule for,
// muted ones included, because the reset clears those too.
function trackedCount(stats) {
  var count = 0
  for (var key in (stats || {})) count += 1
  return count
}

function learningLabel(tracked) {
  var count = Number(tracked) || 0
  if (count === 0) return "Nothing learned yet"
  return String(count) + (count === 1 ? " shortcut" : " shortcuts") + " being tracked"
}

// Spec section 9. Without shadow bindings there is no way to tell a keypress
// from a click, so every effect looks manual. Losing that hook must disable
// effect-based promotion entirely rather than degrade into guessing.
function tiersEnabled(capabilities) {
  var registry = !!(capabilities && capabilities.registry)
  return {
    effects: registry && !!capabilities.shadows,
    commands: registry && !!capabilities.commands
  }
}

if (typeof module !== "undefined") module.exports = {
  defaults: defaults, recordManual: recordManual, recordBind: recordBind,
  mute: mute, tiersEnabled: tiersEnabled, configFor: configFor,
  trackedCount: trackedCount, learningLabel: learningLabel,
  EASE_START: EASE_START, EASE_MIN: EASE_MIN, MAX_INTERVAL_MS: MAX_INTERVAL_MS
}
