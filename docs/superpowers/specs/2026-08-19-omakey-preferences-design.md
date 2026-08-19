# omakey preferences: bar widget, toast placement, intensity, categories

Companion to `2026-08-19-omakey-key-promoter-design.md`. That spec covers how
omakey decides to speak; this one covers how the user tells it to shut up.

**Amended 2026-08-19**, after the fixed cooldown was replaced by an SM-2
schedule (§2.1), and after the toast's dwell time became a fourth setting. Where
this document and the code disagree, the code is what shipped; `README.md`
describes the shipped behaviour.

Five requirements, in the maintainer's words:

1. A panel on the bar where the plugin's preferences can be configured.
2. Where the toast appears on screen: an option at install time, and a setting
   inside the bar panel.
3. Choosing the bar section for the panel at install time.
4. Choosing the learning intensity for keybindings.
5. Splitting keybindings by category, with the alert toggleable per category.

## 1. What the platform already does

Three facts were measured against the running system before any of this was
designed. Each removed work from the plan.

### 1.1 There is no Waybar

`which waybar` finds nothing and `~/.config/waybar` does not exist. The bar is
`omarchy-shell`'s own, a Quickshell plugin. The requirement's "panel on the
Waybar" is a plugin declaring `kind: "bar-widget"`.

### 1.2 The installer already asks for the bar section

`omarchy-plugin-add:38-53`:

```bash
default_section=$(jq -r '.barWidget.defaultSection // "center"' "$PLUGINS_DIR/$id/manifest.json")
section=$(printf '%s\n' left center right |
  gum choose --header="Place $id in which bar section?" --selected "$default_section")
```

Requirement 3 therefore costs no code at all: declaring `bar-widget` in `kinds`
and `barWidget.defaultSection` in the manifest is the whole of it.

The prompt is guarded by `interactive || return 0` and `(( ASSUME_YES )) &&
return 0`. **A `--yes` install skips the question**, which is why the README
must document the install command without `--yes`.

Nothing else is asked. The installer never runs plugin code, so requirement 2's
install-time half has no hook to hang on; the maintainer chose to let the toast
default to `bottom-center` and be changed in the panel.

### 1.3 A plugin has exactly one shell.json entry, not two

This was the design's biggest open question and the answer inverted the plan.

`PluginRegistry.findEntryLocation` searches `bar.layout` first and `plugins[]`
second, returning a single location. `isEnabled` ends in
`findEntryLocation(config, key).found`, and `shell.updateEntryInline` walks the
same two places in the same order. So:

- A plugin id appears once, in the layout **or** in `plugins[]`.
- `shell._syncServices` gates on `isEnabled`, so a plugin whose only entry is a
  bar-layout entry **still has its service mounted**. Moving omakey onto the bar
  does not kill the correlator.
- Inline settings live on whichever entry exists.

**The upgrade trap.** `PluginRegistry.setEnabled` inserts into the bar layout
only when `!location.found` (PluginRegistry:503). omakey already has a
`plugins[]` entry, so on an existing install `omarchy plugin enable omakey
--section right` is a silent no-op and the widget never appears. Existing users
must `omarchy plugin disable omakey` first. This is a README note, not code.

Confirmed on the running system, and worse than the code alone suggests: the
CLI prints `Enabled and moved omakey` and exits successfully while changing
nothing. The failure announces itself as a success.

### 1.4 What a bar widget is handed

`Bar.qml:1747-1752` injects exactly three properties:

```qml
if ("bar" in target) target.bar = root
if ("moduleName" in target) target.moduleName = moduleName
if ("settings" in target) target.settings = moduleSettings
```

A widget is **not** handed `service` — that is a `panel` privilege
(`shell.qml:636`). But `Bar.qml:25` declares `property var shell`, so
`bar.shell.updateEntryInline(...)` reaches the persistence path.

### 1.5 `barWidget.schema[]` has no consumer

`schema` is read once, at `shell.qml:696`, stored on the registry entry, and
never rendered anywhere in the shell. Declaring it is correct and cheap, but it
builds no UI. The panel is ours to draw.

### 1.6 Every binding can be attributed to its source file

Measured, not assumed. `hl.bind` is reached through a wrapper, so
`debug.getinfo(2)` reports `helpers.lua` for all 228 bindings. Walking the stack
from level 3 to the first frame outside `helpers.lua` attributes every one:

| Source file | Bindings |
|---|---|
| `bindings/tiling.lua` | 100 |
| `bindings/utilities.lua` | 65 |
| `bindings/media.lua` | 28 |
| `bindings/applications.lua` | 28 |
| `bindings/clipboard.lua` | 4 |
| `bindings/voxtype.lua` | 3 |

228 of 228, no orphans. Category comes from the config the user actually runs,
so a user's own bindings file classifies itself.

## 2. Settings

Three new keys, inline on omakey's shell.json entry. No `config:` sub-object and
no second file: storage rule 3.

| Key | Values | Default |
|---|---|---|
| `toastPosition` | `top-left` `top-center` `top-right` `bottom-left` `bottom-center` `bottom-right` | `bottom-center` |
| `intensity` | `discreet` `balanced` `insistent` | `balanced` |
| `mutedCategories` | array of category ids | `[]` |

`Service.qml:settingsEntry()` currently scans `plugins[]` only. It must mirror
`findEntryLocation`: **bar layout first, `plugins[]` second**. Read and write
have to agree on which entry is authoritative, or the panel saves into one
object and the correlator reads another. The precedence lives in
`SettingsModel.resolveEntry`, where it can be tested.

`intensity` replaces the four individually-configurable policy numbers.
No migration is needed: the installed entry is a bare `{"id": "omakey"}`.

### 2.1 Intensity presets

```
discreet    quietFirst 6   learnedAfter 3    giveUpAfter 3    cooldownMs 300000
balanced    quietFirst 3   learnedAfter 5    giveUpAfter 5    cooldownMs 60000
insistent   quietFirst 1   learnedAfter 8    giveUpAfter 10   cooldownMs 15000
```

**As shipped**, two of these four are gone. `learnedAfter` was dropped when
adoption stopped being a counter and became the SM-2 review, and `cooldownMs`
became `baseIntervalMs`: no longer a flat wait between hints but I(1), the first
step of a schedule that grows on every success and collapses on a lapse. The
numbers are unchanged, so `balanced` still means what it meant; what changed is
that the interval no longer stays where the preset put it. See
`PolicyModel.js:PRESETS`.

`balanced` is exactly today's behaviour, so the default changes nothing for an
existing user. `PolicyModel.defaults()` keeps returning it.

The three move together on purpose: a user who wants fewer hints wants a longer
cooldown *and* an earlier give-up, and asking them to reason about four
independent counters is asking them to reason about the correlator.

## 3. Categories

`lua/registry.lua` gains `origin()` and prints it as a seventh TSV column.
`RegistryModel.parseRegistry` exposes it as `source`.

`CategoryModel.js` folds source files into four groups:

| Category | Source files | Bindings |
|---|---|---|
| `tiling` | `tiling` | 100 |
| `system` | `utilities`, `clipboard`, `voxtype` | 72 |
| `applications` | `applications` | 28 |
| `media` | `media` | 28 |

The grouping table is a **display convenience with a fallback, never a filter**.
Any source file the table does not know becomes its own category, id and label
derived from the basename. A reorganised Omarchy, or a user's own bindings file,
produces a new row in the panel rather than bindings that silently stop being
promotable. This is the mitigation for the one real hazard of a hand-written
grouping: a stale table that loses bindings without saying so.

### 3.1 Where the gate sits

In `Service.handlePromotion`, **before** `PolicyModel.recordManual`.

A muted category must not consume the `quietFirst` budget, advance `hintCount`,
or trip self-demotion. Silence has to be free, or unmuting a category later
would find its counters already exhausted and stay quiet anyway.

Learning is not gated. `handleLesson` keeps mapping effects to bindings inside a
muted category, because the map is what makes an eventual unmute useful. Only
the hint is suppressed.

## 4. How the widget and the service talk

Two one-way channels, each on a documented contract.

- **widget to service.** `bar.shell.updateEntryInline("omakey", next)` persists
  to shell.json; `Service.qml` already reads `shell.shellConfig` reactively.
- **service to widget.** The service writes the category list and its counts
  into the `stats.json` the `Store` already owns; the widget reads it with
  `FileView { watchChanges: true }`.

Folding categories into the existing file rather than adding a second one keeps
non-negotiable 2 intact: `~/.local/state/omakey/stats.json` remains the only
file omakey creates outside its own directory. `stats.json` stays at
`version: 1` with a new optional `categories` field; a reader that ignores it is
unaffected.

The widget deliberately does not reach into `shell._services`. That is not a
documented contract, and a plugin that depends on the host's private state
breaks on an upgrade it cannot see coming.

## 5. Units

| Path | Change |
|---|---|
| `manifest.json` | `bar-widget` in `kinds`, `entryPoints.barWidget`, `barWidget` block with `defaultSection: "right"` |
| `Widget.qml` | **new** — bar icon plus the preferences popup. Not `BarWidget.qml`: `qs.Ui` exports a type by that name, and a local file would shadow the base it extends |
| `SettingsModel.js` | **new** — entry precedence, defaults, normalisation |
| `CategoryModel.js` | **new** — source-file grouping with fallback, counts |
| `lua/registry.lua` | `origin()` and the seventh column |
| `RegistryModel.js` | parse `source` |
| `PolicyModel.js` | `presets()`, `configFor(intensity)` |
| `Service.qml` | entry precedence, preset config, category gate, toast position in the payload |
| `Toast.qml` | anchors driven by `toastPosition` |
| `tests/` | `settings.test.js`, `category.test.js`; extends `registry.test.js` and `policy.test.js` |

Every decision lands in a plain `.js` model, ES5-flavoured, exported through the
`module.exports` tail. QML does I/O and wiring only, because QML is what cannot
be unit-tested here.

## 6. Error handling

- **Unknown setting value.** `SettingsModel` normalises: an unrecognised
  `toastPosition` or `intensity` falls back to the default rather than leaving
  the toast unanchored. A `mutedCategories` that is not an array is read as `[]`.
- **No entry in shell.json.** `resolveEntry` returns null and every setting
  takes its default. The service runs; the plugin is simply unconfigured.
- **Missing `source` column.** A binding scanned by an older `registry.lua`, or
  one whose stack walk found nothing, gets `source: ""` and lands in an
  `other` category. It is never dropped and never silently promoted under a
  category the user muted.
- **`updateEntryInline` unavailable.** If `bar.shell` is null or lacks the
  method, the widget shows the change but logs that it could not persist,
  rather than pretending it saved.

## 7. Testing

`node --test` covers the four models: preset values, entry precedence across
both storage locations, normalisation of every malformed input above, the
grouping table, the unknown-file fallback, and counts.

Against the running desktop: `omarchy plugin validate .`, then
`omarchy restart shell`; the widget appears in the chosen section; changing
intensity and position writes shell.json and the next toast obeys; muting
`tiling` suppresses the 100 tiling hints and leaves the other three categories
speaking.

## 8. What was verified live, and what was not

Against the running shell: the service stays mounted with its only shell.json
entry in the bar layout; the scan produces the four categories with the counts
above and publishes them to the state file; and settings resolve from the
layout entry rather than from `plugins[]`.

Not verified live: a suppressed promotion in a muted category. The
cursor-activity gate sits ahead of the category gate and is not satisfied by
`hyprctl dispatch movecursor`, so reaching it needs a real pointer device. The
category gate is covered by unit tests instead.

## 9. Deliberately out of scope

**Bar-aware toast margins.** With `bar.position: "top"` and
`toastPosition: "top-center"`, the toast can overlap the bar. Reading
`shell.barConfig.position` and offsetting would fix it. It is not in this spec
because it was not asked for; it is recorded here so the next person does not
mistake it for an oversight.

**Per-binding toggles.** Rejected as 228 rows of persisted state and a
100-item list inside one category, for a control the category toggle already
approximates.
