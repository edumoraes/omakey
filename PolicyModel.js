// Decides whether the user should actually be told. A Key Promoter's failure
// mode is being uninstalled for nagging, so every rule here exists to say less.

function defaults() {
  return { quietFirst: 3, learnedAfter: 5, giveUpAfter: 5, cooldownMs: 60000 }
}

function _entry(stats, key) {
  var existing = stats[key]
  return {
    manualCount: (existing && existing.manualCount) || 0,
    bindCount: (existing && existing.bindCount) || 0,
    hintCount: (existing && existing.hintCount) || 0,
    lastHintAt: (existing && existing.lastHintAt) || -1,
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

function recordManual(stats, key, now, config) {
  var settings = config || defaults()
  var entry = _entry(stats || {}, key)
  entry.manualCount += 1

  var reason = ""
  if (entry.muted) reason = entry.mutedBy === "self" ? "gave-up" : "muted"
  else if (entry.bindCount >= settings.learnedAfter) reason = "learned"
  else if (entry.manualCount <= settings.quietFirst) reason = "quiet-start"
  else if (entry.lastHintAt >= 0 && now - entry.lastHintAt < settings.cooldownMs) reason = "cooldown"

  if (reason) return { stats: _with(stats || {}, key, entry), show: false, reason: reason }

  entry.hintCount += 1
  entry.lastHintAt = now

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

function recordBind(stats, key, now) {
  var entry = _entry(stats || {}, key)
  entry.bindCount += 1
  entry.hintCount = 0
  return _with(stats || {}, key, entry)
}

function mute(stats, key) {
  var entry = _entry(stats || {}, key)
  entry.muted = true
  entry.mutedBy = "user"
  return _with(stats || {}, key, entry)
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
  mute: mute, tiersEnabled: tiersEnabled
}
