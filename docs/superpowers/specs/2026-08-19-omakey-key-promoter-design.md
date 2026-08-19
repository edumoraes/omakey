# omakey — a Key Promoter for Omarchy

**Status:** approved; plan Task 1 executed, Tasks 2-12 outstanding
**Date:** 2026-08-19
**Target:** Omarchy 4.0.0.alpha, Hyprland 0.56.2
**Amended:** 2026-08-19 — §12 questions 1 and 2 answered, §12.1 added and decided

## 1. What it is

When you do something with the mouse that a keybinding already does, omakey
shows you the keybinding you could have pressed. It is IntelliJ's Key Promoter X,
applied to the Omarchy desktop.

It ships as a third-party Omarchy shell plugin: a git repository with a
`manifest.json` at its root, installed with `omarchy plugin add <git-url>`.

Two properties are non-negotiable, because the plugin is meant to be published:

1. **No persistent modification of the user's machine.** No edits to
   `~/.config/hypr/`, no dotfile hooks, no `PATH` shims. Everything the plugin
   installs into the running system is injected at runtime and disappears on
   `hyprctl reload`.
2. **When a detector cannot be trusted, it goes silent.** Never guess. The
   failure mode of a Key Promoter is being uninstalled for nagging.

## 2. Scope

In scope — the manual actions omakey promotes:

- **Window and workspace management** — closing a window, switching workspaces
  from the bar, fullscreen, floating, scratchpad.
- **Launching applications** — opening a terminal from a launcher instead of
  `SUPER+RETURN`.
- **Omarchy menu entries and bar widgets** — picking *Screenshot* from the menu,
  clicking the audio widget.

Out of scope:

- **Window focus by mouse click.** Excluded deliberately: with focus-follows-mouse
  it is a constant source of false positives, and the signal carries almost no
  teaching value.

## 3. Verified findings

Everything in this section was checked against the running system on 2026-08-19.
The design rests on it, so it is recorded with its evidence.

### 3.1 Reading the user's keybindings

Under the Omarchy 4 Lua config provider, `hyprctl binds` reports every binding as
`dispatcher: __lua, arg: <opaque integer>`. The key and description survive; the
semantics do not. `hyprctl binds` alone is therefore **not** a usable registry.

Omarchy already solves this. `omarchy-menu-keybindings` runs
`~/.config/hypr/hyprland.lua` inside a Lua sandbox where `hl` is replaced by
proxy tables, and captures every `hl.bind(keys, dispatcher, opts)` call. The
result is a full semantic registry:

```
SUPER + W        → Close window     lua    hl.dsp.window.close()
SUPER + F        → Full screen      lua    hl.dsp.window.fullscreen({ mode = "fullscreen" })
SUPER + RETURN   → Terminal         exec   omarchy-launch-terminal
```

It is cached at `~/.cache/omarchy/keybindings-<sha256>.records` as TSV, keyed by a
hash of `hyprctl binds` plus the active keymap. Because the scan starts from the
user's own config file, user overrides come for free.

omakey uses the same technique in its own scanner rather than reading Omarchy's
cache file. The technique depends only on Hyprland's `hl.bind` API; the cache path
and format are Omarchy internals that can change.

### 3.2 Runtime injection

| Fact | Evidence |
| --- | --- |
| `hyprctl keyword` is refused under the Lua parser | `keyword can't work with non-legacy parsers. Use eval.` |
| `hyprctl eval <lua>` executes Lua in the live VM | returns `ok`; no value channel, so introspection needs file IO from Lua |
| `hl.bind(keys, luaFunction, {description=...})` registers at runtime | bind count 228 → 229, listed with `dispatcher: __lua` |
| `hl.unbind(keys)` removes **every** bind on that combination | 229 → 226; it took Omarchy's two `ALT+TAB` binds with it |
| `hyprctl reload` restores the full original state | back to 228, both `ALT+TAB` binds present |

The `hl` surface, enumerated at runtime: `bind`, `unbind`, `on`, `dispatch`,
`dsp` (table), `timer`, `notification`, `get_cursor_pos`, `is_key_down`,
`get_windows`, `get_active_window`, `layer_rule`, `window_rule`, and more.

**Consequence for teardown:** there is no per-bind removal. Uninstall and
re-injection must go through `hyprctl reload`, which re-runs the user's Lua config
and drops everything injected at runtime. This is cleaner than selective removal —
it is a total reset — but it means omakey must never call `hl.unbind`.

### 3.3 Parallel binds both fire

Hyprland executes **all** bindings registered on the same key combination.

Omarchy's own defaults depend on this: `tiling.lua` binds `ALT+TAB` twice, to
`hl.dsp.window.cycle_next()` and `hl.dsp.window.bring_to_top()`, and both are
registered.

Confirmed empirically: a third `ALT+TAB` binding was injected at runtime with a
Lua function that appended to a file. Pressing `ALT+TAB` cycled focus normally
**and** wrote to the file, with the active-window context alternating across
consecutive fires.

This is the linchpin. It means omakey can *shadow* any binding — register a
parallel binding on the same key that only reports "this binding fired" — without
touching the original.

### 3.4 Custom events on socket2

`hl.dsp.event("name,data")` builds a dispatcher that emits `custom>>name,data`
on Hyprland's socket2. Verified:

```
hyprctl eval 'hl.dispatch(hl.dsp.event("omakey,test"))'   →   custom>>omakey,test
```

A bare `hl.dsp.event(...)` only constructs the dispatcher; it must be run by
`hl.dispatch` or bound to a key.

So a shadow binding is literally this, with no Lua closure, no forked process and
no side channel:

```lua
hl.bind("SUPER + T", hl.dsp.event("omakey,42"), {})
```

The prize is not the saved fork — it is **ordering**. The "you pressed a key"
signal and the "state changed" signal arrive on the same ordered stream that the
plugin already reads. Correlation stops being a wall-clock race.

### 3.5 No keybind-executed event

The `hl.on` catalogue, extracted from the Hyprland binary:

```
window.{open, open_early, close, destroy, active, fullscreen,
        move_to_workspace, pin, title, class, urgent, update_rules}
workspace.{active, created, removed, move_to_monitor, special_active}
monitor.{added, removed, focused, layout_changed}
layer.{opened, closed}
config.{reloaded, props_refreshed}
keybinds.submap, hyprland.{start, shutdown}, screenshare.state, xwayland.enabled
```

There is no "a keybinding fired" event. Shadow bindings are therefore mandatory,
not a convenience.

### 3.6 The shell's command choke point

`Commons/Util.qml` is a `pragma Singleton`. `Util.execDetached(command)` runs
`["bash", "-lc", command]` and is called by both `Menu.runAction`
(`plugins/menu/Menu.qml:141`) and `Bar.run` (`plugins/bar/Bar.qml:614`).

Bar widget clicks route through it carrying the exact registry expression.
`plugins/bar/widgets/Workspaces.qml:35`:

```qml
root.bar.run("hyprctl dispatch " + Util.shellQuote("hl.dsp.focus({ workspace = \"" + id + "\" })"))
```

The registry holds `SUPER + 3 → hl.dsp.focus({ workspace = "3" })`. Matching them
is string equality, not heuristics.

Two related facts: Hyprland spawns `exec` bindings through `/bin/sh`, while the
shell uses `bash -lc` — a discriminator that would have allowed a
`~/.bash_profile` hook. That approach is **rejected** here because it is a
persistent modification of the user's machine, which rule 1 forbids.

### 3.7 Measured coverage

- **20 of 257** Omarchy menu actions have an `action:` string identical to a bound
  command. Normalising command prefixes (`uwsm-app --`) adds nothing — 20 is the
  real number. They are good ones: `PRINT` screenshot, `SUPER CTRL+L` lock,
  `SUPER CTRL+N` nightlight, `SUPER+K` keybindings, `SUPER+PRINT` colour picker,
  `SUPER SHIFT+SPACE` toggle bar.
- **6 bar call sites** use `bar.run`: Workspaces, KeyboardLayout, Microphone,
  SystemUpdate, Dictation, ScreenRecording — plus custom modules
  (`plugins/bar/Bar.qml:1803`).
- Rich popup widgets (audio, bluetooth, network) open panels **in-process** via
  `bar.shell.summon`, invisible to a command hook — but they are layer-shell
  surfaces, so `layer.opened` reports them. Their bindings exist:
  `SUPER CTRL+A`, `SUPER CTRL+B`, `SUPER CTRL+W`.
- `plugins/panels/audio/Panel.qml` calls `Quickshell.execDetached` directly,
  bypassing `Util`. Accepted loss: the actions inside that panel (switching sink)
  have no binding to promote anyway.

## 4. Architecture

```
┌─ Hyprland (Lua VM) ─────────────────────────────┐
│  omakey.lua, injected at runtime via            │
│  hyprctl eval — re-injected on config.reloaded  │
│  · one shadow bind per binding:                 │
│    hl.bind(keys, hl.dsp.event("omakey,<id>"))   │
│  · cursor activity poller (hl.timer)            │
│  · no state, no logic, no closures              │
└────────────────┬────────────────────────────────┘
                 │  socket2 — one ordered stream
                 │    custom>>omakey,42   ← the key
                 │    workspacev2>>3,3    ← the effect
                 ▼
┌─ omarchy-shell (QML) ───────────────────────────┐
│  service/  the brain                            │
│   · Correlator  effect × shadow × command       │
│   · Mapper      effect → candidate binding      │
│   · Promoter    adaptive policy, counters       │
│   · wraps Util.execDetached                     │
│  panel/    the toast (modelled on omarchy.osd)  │
└─────────────────────────────────────────────────┘
```

The brain lives in QML, not in Lua, deliberately: a fault in the Lua half runs
**inside the compositor**, and the menu/bar half is only observable from inside
the shell. Splitting the brain across both would be worse than either. The Lua
half stays deliberately stupid.

### 4.1 Units

| Unit | Where | Responsibility | Depends on |
| --- | --- | --- | --- |
| `Registry` | external process (Lua), driven from QML by `Process` | scan `hyprland.lua` in a stubbed-`hl` sandbox → list of `(modmask, key, description, kind, arg)` | Hyprland's `hl.bind` API |
| `Injector` | QML service | inject shadow bindings via `hyprctl eval`; re-inject on `config.reloaded` | `Registry` |
| `Correlator` | QML service | consume socket2, separate shadow / command / orphan effect, decide mouse vs keyboard | — |
| `Mapper` | QML service | effect → candidate binding; seeded from dispatchers, corrected by observation | `Registry` |
| `Promoter` | QML service + panel | adaptive policy, counters, the toast | `Mapper` |

`Correlator` does not know what a binding is. `Mapper` does not know what a raw
event is. `Promoter` does not know Hyprland exists. Each is testable against a
recorded stream.

### 4.2 Two rules that keep the plugin polite

- **Shadow bindings carry no `description`.** `omarchy-menu-keybindings` drops
  `__lua` bindings without a description
  (`[[ -z $description && $dispatcher == "__lua" ]] && continue`). Without this,
  the user's cheat sheet would gain 228 lines of noise. Side effect: injecting
  changes the `hyprctl binds` hash, so Omarchy's keybindings cache rebuilds once,
  then stabilises.
- **Every binding is shadowed, not only the promotable ones.** 228 extra bindings
  are irrelevant to Hyprland, and full coverage of the "it was the keyboard" side
  is what prevents false positives.

## 5. The correlation algorithm

Shadow bindings are registered *after* the user's config, so they execute after it.
socket2 therefore delivers **the effect first and the shadow second**:

```
workspacev2>>3,3          ← effect arrives first
custom>>omakey,42         ← shadow follows
```

The `Correlator` cannot judge on arrival. It **holds each effect for a grace
window** (~150 ms) and promotes only if no shadow appears. A toast 150 ms late is
imperceptible, and the same window absorbs two other problems for free: the
multi-fire seen during the probe, and event bursts where one action emits several
events.

The `Correlator` is deliberately written to be order-tolerant — a shadow within
the window before *or* after the effect suppresses it — so a change in Hyprland's
bind execution order cannot silently break it.

Three inputs, not two:

1. `custom>>omakey,<id>` — keyboard → suppress
2. a command captured at `Util.execDetached` — mouse, **with exact binding
   identity** → promote with high confidence
3. an orphan effect — mouse of unknown origin → hand to `Mapper`

## 6. Action catalogue by confidence tier

### Tier A — string equality, near-zero false positives

Any menu entry or bar command whose string matches a binding's `exec` argument or
Lua expression. Measured coverage in §3.7.

### Tier B — effect with a determined target

- `layer.opened` for a panel namespace → `SUPER CTRL + A/B/W`.
- `window.open` → class → the `exec` binding that launches that class, via the
  seeded-and-learned map.

### Tier C — noisy, enabled by default

`window.close`, `window.fullscreen`, floating-mode changes.

The honest risk: an app's own `Ctrl+W` or `Ctrl+Q` is not a Hyprland binding, so
it has no shadow. The effect arrives orphaned and omakey would say "you could have
pressed `SUPER+W`" — wrong, and irritating. The browser's `F11` hits
`window.fullscreen` the same way. A window rule can float a window with no user
action at all.

The user chose to enable Tier C by default. The design pays for that bet with the
two brakes in §7 rather than trusting the heuristic alone.

### 6.1 The cursor activity signal

`hl.get_cursor_pos()` returns `{x, y}`, and `hl.timer` exists. An in-Lua poller at
~20 Hz emits `custom>>omakey,cursor:moving|idle` **only on transitions**, so
traffic is negligible.

A keyboard action tends to happen with the cursor parked for seconds; a mouse
action happens with the cursor freshly moved. Not proof, but it removes most of
the Tier B and C false positives without `/dev/input`, without root, and without
an extra process.

## 7. Adaptive policy

Per promotable action: `manualCount`, `bindCount`, `hintCount`, `lastHintAt`,
`muted`.

- **Quiet start** — no hint for the first `quietFirst` occurrences. Let the user work.
- **Cooldown** — at most one hint per action per time window.
- **Fades on learning** — once `bindCount` passes `learnedAfter`, stop.
- **Self-demotion** — if a hint has fired `giveUpAfter` times and `bindCount` is
  still **zero**, mute that action permanently.

Self-demotion is what makes Tier C survivable. A systematic false positive — the
browser's `Ctrl+W` read as a missed `SUPER+W` — extinguishes itself after
`giveUpAfter` appearances, because the user will never adopt a binding that does
not do what they wanted. The plugin measures its own precision instead of the
design promising it.

A second brake, specific to `window.close`: promote only if the cursor is **inside
the rectangle of the window that closed** and has moved recently. The `Correlator`
keeps a geometry cache keyed by window address; `hl.get_cursor_pos()` supplies the
rest. Closing with `Ctrl+Q` while the mouse sits idle across the screen produces no
hint.

The toast offers "mute this action", which sets `muted` directly.

## 8. Persistence and configuration

Counters **and the learned effect→binding map** go to
`~/.local/state/omakey/stats.json`, **not** to `shell.json`. `shell.json` is a
user-edited file that hot-reloads on save; writing statistics into it on every
action fights the file's owner and risks a reload loop.

Configuration goes on the plugin's entry in `shell.json`, which is the Omarchy
convention:

```json
{ "id": "<author>.omakey",
  "detect": { "commands": true, "surfaces": true, "windowState": true },
  "quietFirst": 3, "learnedAfter": 5, "giveUpAfter": 5,
  "cursorIdleMs": 800, "graceMs": 150 }
```

The `detect` keys are the tiers of §6: `commands` is Tier A, `surfaces` is
Tier B, `windowState` is Tier C. `graceMs` is the correlation window of §5.

## 9. Degradation

Every hook is feature-detected at load and fails in isolation.

| Failure | Consequence |
| --- | --- |
| `hyprctl eval` unavailable, or `hl.bind` changes signature | **disable effect-based promotion entirely**; keep Tier A |
| `Util.execDetached` not wrappable | lose Tier A; keep Tiers B and C |
| empty binding registry | promote nothing, log, exit |

The first row is the most important rule in the design: **without shadow bindings
every event looks like a false positive.** If that hook dies, effect-based
detection must die with it. Never degrade into guessing.

## 10. Uninstall

`hyprctl reload` drops everything injected. Nothing persists on the system except
`~/.local/state/omakey/stats.json`, which the user can delete.

## 11. Testing

`Correlator`, `Mapper` and `Promoter` are functions over an event stream, so they
are tested against recorded fixtures.

The plugin ships a `record` mode that captures the real socket2 stream alongside
the verdict it produced. That is how the cursor heuristic gets calibrated against
the user's actual behaviour instead of the design's assumptions, and it is what
makes Tier C defensible over time.

## 12. Open questions

These must be resolved by spikes before or during implementation. None of them
invalidates the architecture; each changes one unit.

1. **Can a third-party plugin wrap `Util.execDetached`?**
   **Answered 2026-08-19: no.** All three routes are refused:

   | Attempt | Result |
   | --- | --- |
   | `Util.execDetached = fn` | `TypeError: Cannot assign to read-only property "execDetached"` |
   | `Object.defineProperty(Util, "execDetached", …)` | does not throw, silently ignored |
   | `Quickshell.execDetached = fn` | `TypeError: Cannot assign to read-only property "execDetached"` |

   QML exposes singleton methods as read-only properties, and `defineProperty`
   does not reach a QObject's meta-object. **Tier A as designed has no
   in-process hook.** §9's degradation rule applies: lose Tier A, keep Tiers B
   and C. What that actually costs is narrower than "Tier A dies", and is worked
   out in §12.1 below.

2. **Can a third-party plugin `import qs.Commons`?**
   **Answered: yes.** The installed third-party plugin
   `~/.config/omarchy/plugins/now-playing` imports both `qs.Commons` and `qs.Ui`,
   and omakey's own probe resolved `Util` through the same import.

3. **Why did the shadow probe fire six times?**
   **Answered 2026-08-19: it was six presses.** One keypress fires its shadow
   exactly once. Measured by pressing `SUPER + ESCAPE` four times through a
   virtual keyboard while reading socket2 directly: four presses, four
   `custom>>omakey,139` lines, one each. The grace window does not have to
   absorb a repeat.

   The same measurement produced a finding that does change a unit. **The
   shadow leads the effect, and by more than the 150 ms the plan assumed.**

   | Press | shadow at | effect at | lead |
   | --- | --- | --- | --- |
   | open the system menu | `…710092` | `openlayer` `…710401` | **309 ms** |
   | close it again | `…712123` | `closelayer` `…712251` | **128 ms** |

   Binding 139 is `exec omarchy-menu toggle system`, so the gap is the menu
   process starting; the first press pays a cold start, the second does not. A
   symmetric 150 ms window would have failed to suppress a keyboard-driven menu
   open — a false positive on exactly the action the user just performed
   correctly.

   The window is therefore split rather than widened. Effects are held only
   `graceMs` (150 ms) before promoting, because a shadow that leads needs no
   hold at all; suppression looks back `shadowMs` (600 ms) for a preceding
   shadow. Holding longer would delay every hint; looking back further only
   errs toward silence, which is the direction §9 requires. Recorded as
   `tests/fixtures/stream-mixed.jsonl`.
4. **Panel layer namespaces** for audio/bluetooth/network are still unverified.
   `omarchy-background`, `omarchy-bar` and `omarchy-menu` have been observed
   live.
5. **`hl.on` signature and runtime behaviour** are inferred from binary strings and
   Omarchy's usage, not exercised. The Lua half only needs `hl.bind`, `hl.timer`
   and `hl.get_cursor_pos`, all verified — `hl.on` is currently unused by this
   design.

### 12.1 What losing the command hook actually costs

Less than "Tier A dies", because the busiest paths it covered are visible as
effects anyway.

**Survives without the hook**, through Tier B:

- Clicking a workspace in the bar — the click produces `workspacev2` with no
  shadow, which is exactly the orphan-effect case. This was the single most
  frequent Tier A path.
- Opening the audio, bluetooth or network panel by clicking its widget — the
  panel is a layer-shell surface, so `layer.opened` reports it, and the
  bindings exist (`SUPER CTRL + A/B/W`).
- Switching keyboard layout from the bar — `activelayout` is an event; add it
  to the effect map.

**Genuinely lost**: the Omarchy menu. Most of its 20 matching entries produce no
Hyprland event at all — screenshot, lock, colour picker, keybindings viewer,
toggle bar, nightlight.

**Partially recoverable without any hook.** Some Omarchy toggles write marker
files under `~/.local/state/omarchy/toggles/` and
`~/.local/state/omarchy/indicators/` (`suspend-off` and `stay-awake` exist right
now), and a `FileView` with `watchChanges` detects those with no hook
whatsoever. Others leave nothing — `omarchy-toggle-nightlight` drives
`hyprctl hyprsunset` directly and writes no file. Recovering this way needs a
per-action audit, and it would be a new detector, not a repair of Tier A.

**Decided 2026-08-19: ship without menu coverage, and pursue the upstream signal
in parallel.** Tiers B and C now cover the bar, workspaces, panels and windows,
which is a useful plugin on its own; the menu half returns without a redesign if
§13's signal lands, because the correlator already accepts a command input. The
state-file detector is explicitly *not* being built — it would buy 5 or 6 of the
20 entries at the cost of a new surface coupled to Omarchy's internal state
paths.

## 13. Upstream

Tier A was going to reach into Omarchy's internals by wrapping
`Util.execDetached`. §12 records why that is impossible, and §12.1 records the
decision to ship without it. What would restore Tier A is upstream emitting a
signal when the shell runs a command — a few lines, additive, no behaviour
change.

That is now the *only* route to menu coverage, which makes it worth pursuing on
its own merits rather than as tidying. It is not a blocker: the correlator
already accepts a command input, so the signal drops into a seam that is
designed for it, whenever it lands.

The post is drafted at
[`docs/upstream/2026-08-19-command-executed-signal.md`](../../upstream/2026-08-19-command-executed-signal.md)
and has **not** been published. Route it per Omarchy's own
`contributing.md`: feature ideas go to Discussions
(https://github.com/basecamp/omarchy/discussions/categories/suggestions), not
Issues.

## 14. Explicitly rejected

- **Reading `/dev/input`.** Works — the user is in the `input` group — but an
  unsandboxed plugin reading raw keyboard input is not something to publish.
- **A Hyprland C++ plugin.** Breaks on every Hyprland update; Omarchy updates
  Hyprland.
- **A `~/.bash_profile` hook.** Technically the cleanest discriminator (§3.6), but
  it is a persistent modification of the user's machine.
- **Editing `~/.config/hypr/hyprland.lua`.** Unnecessary once runtime injection
  was proven.
- **Cloning or patching first-party Omarchy plugins.** Breaks on every update.
