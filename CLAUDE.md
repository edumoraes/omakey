# CLAUDE.md — omakey

> A Key Promoter for the Omarchy desktop: when you do something with the mouse
> that a keybinding already does, it shows you the keybinding. This file tells
> AI agents what is decided, what is verified, and what will break the user's
> session if you get it wrong.

## Status

**All twelve plan tasks are implemented and verified against the running
desktop.** The two documents still come first:

- `docs/superpowers/specs/2026-08-19-omakey-key-promoter-design.md` — the design,
  including every platform fact that was verified rather than assumed.
- `docs/superpowers/plans/2026-08-19-omakey.md` — twelve tasks, each ending in a
  tested, committable deliverable. The plan is a historical record now; where it
  disagrees with the code, the code won and the commit message says why.

Everything in the architecture map below exists, except `CommandHook.qml`, which
was cancelled: `Util.execDetached` cannot be wrapped (spec §12, §12.1). Tier A
is permanently unavailable and `capabilities.commands` is hardcoded false.

What the plan got wrong, and the measurements that corrected it:

| Plan said | Reality |
|-----------|---------|
| `graceMs: 150`, symmetric | The shadow *leads* its effect by up to 309 ms for an `exec` binding. The window is split: hold `graceMs`, look back `shadowMs` (600). Spec §12 Q3 |
| `hl.timer(interval, callback)` | `hl.timer(callback, { timeout = <ms>, type = "repeat"\|"oneshot" })` |
| `hyprctl eval <lua>` | `hyprctl eval -- <lua>`; a payload starting with `--` is read as a flag |
| `shell.pluginSettings(id)` | Does not exist. Settings are inline fields on the plugin's entry in `shell.json`'s `plugins[]` |
| `shell.callIfLoaded` for the toast's mute | Routes to *panel* loaders — it would call back into the toast. A panel declaring `property var service` is handed its own service |
| Geometry from `Hyprland.toplevels` | No type information ships for it; `hyprctl clients -j` is the documented contract |
| A shadow probe fired six times | One keypress fires its shadow exactly once; it was six presses |

Read the spec before the plan, and both before writing code.

---

## Non-negotiables

These are not style preferences. Breaking any of them either damages the user's
running desktop or turns the plugin into the thing nobody wants installed.

1. **Never call `hl.unbind`.** It removes *every* binding registered on that key
   combination, including Omarchy's own. This was discovered by breaking it:
   unbinding one shadow binding on `ALT+TAB` took Omarchy's `cycle_next` and
   `bring_to_top` with it. Teardown and re-injection go through `hyprctl reload`.
2. **No persistent modification of the user's machine.** No writes to
   `~/.config/hypr/`, no `~/.bash_profile` hooks, no `PATH` shims, no patching of
   first-party Omarchy plugins. Everything installed into the running system is
   injected at runtime and vanishes on `hyprctl reload`. The only file omakey
   creates outside its own directory is `~/.local/state/omakey/stats.json`.
3. **Shadow bindings carry no `description`.** `omarchy-menu-keybindings` filters
   out descriptionless `__lua` bindings; a description would add 228 lines of
   noise to the user's keybinding cheat sheet.
4. **Silence over guessing.** If a hook cannot be verified at load, the detector
   that depends on it is disabled. In particular: without shadow bindings there is
   no way to tell a keypress from a click, so losing that hook must disable
   effect-based promotion *entirely* rather than degrade into guessing.
5. **English only in this repository** — code, comments, documentation, commit
   messages. The plugin is meant to be published. Conversation with the
   maintainer is in Portuguese; the artifact never is.
6. **No symlinks anywhere in the repository.** `omarchy plugin validate` rejects
   the whole folder if it finds one, and the repository root *is* the plugin
   folder — `omarchy plugin add` clones it straight into
   `~/.config/omarchy/plugins/<id>/`.
7. **No emojis** in code, docs, or commits unless asked for.

---

## Architecture map (planned)

Entry-point QML stays flat at the repository root, matching the third-party
plugin convention. Subdirectories hold only files the shell does not load
directly.

| Path | Responsibility |
|------|----------------|
| `manifest.json` | Plugin manifest. `kinds: ["service", "panel"]`, id `omakey` |
| `Service.qml` | `service` entry point. Wires every unit, owns feature detection |
| `Registry.qml` | Runs `lua/registry.lua` through `Process`, exposes the binding list |
| `Injector.qml` | Applies the shadow-binding payload through `hyprctl eval` |
| `Ingest.qml` | socket2 → correlator; also the `record` mode that produces fixtures |
| ~~`CommandHook.qml`~~ | **Cancelled.** It was to wrap `Util.execDetached`; QML refuses the assignment |
| `Store.qml` | Loads and saves `~/.local/state/omakey/stats.json` |
| `Toast.qml` | `panel` entry point. The hint UI, layer namespace `omakey-toast` |
| `Widget.qml` | `bar-widget` entry point. The preferences panel. **Not** `BarWidget.qml` — `qs.Ui` exports a type by that name and a local file would shadow the base it extends |
| `RegistryModel.js` | Parse scanner TSV into binding objects |
| `PayloadModel.js` | Build the Lua payload for `hyprctl eval` |
| `CorrelatorModel.js` | Grace window, three-input decision |
| `MapperModel.js` | Effect → candidate binding (dispatcher seed plus learned) |
| `PolicyModel.js` | SM-2 hint schedule, counters, tier gating, intensity presets |
| `SettingsModel.js` | shell.json entry precedence, defaults, normalisation |
| `CategoryModel.js` | Source file to category, with a fallback for unknown files |
| `ToastModel.js` | Where the hint card sits. Arithmetic, because anchors cannot be cleared |
| `lua/registry.lua` | Binding scanner: stubbed-`hl` sandbox over the user's config |
| `lua/cursor.lua` | Cursor activity poller payload |
| `tests/` | `node --test` unit tests and recorded socket2 fixtures |

### Runtime flow

1. `Service.qml` loads, resolves its own install path, and runs `Registry.qml`.
2. `lua/registry.lua` scans `~/.config/hypr/hyprland.lua` in a sandbox where `hl`
   is a proxy, and prints every binding as TSV. Nothing reaches the compositor.
3. `Injector.qml` builds one `hl.bind(keys, hl.dsp.event("omakey,<id>"), {})` per
   binding and applies them with `hyprctl eval`.
4. Pressing any bound key now emits `custom>>omakey,<id>` on Hyprland's socket2 —
   the *same ordered stream* that carries `workspacev2`, `openwindow`,
   `closewindow`. That shared ordering is the whole design.
5. `Ingest.qml` feeds both kinds of event into `CorrelatorModel`, which holds each
   state-change event for a grace window and promotes only the ones that arrived
   without a shadow.
6. `MapperModel` turns a promoted effect into a binding, `PolicyModel` decides
   whether the user should be told, and `Toast.qml` says it.

Shadow bindings live in Hyprland, not in the shell. **A plugin reload does not
remove them.** Run `hyprctl reload` before re-injecting, or the bind count grows
on every reload.

---

## Development loop

```sh
# Install the working copy as a plugin. A symlinked plugin *directory* is fine;
# symlinks *inside* it are not.
ln -sfn "$PWD" ~/.config/omarchy/plugins/omakey
omarchy plugin validate .        # run this before loading; silent on success
omarchy-shell shell rescanPlugins
omarchy plugin enable omakey     # takes a placement argument, not --yes

# QML changes need a real restart. rescanPlugins re-instantiates the plugin from
# Qt's cached compiled QML and will happily re-run stale code.
omarchy restart shell

node --test                      # all logic is plain JS, so this covers it.
                                 # Bare, no path: Node 25 resolves a positional
                                 # `tests/` as a module and dies before running.
journalctl --user -t omarchy-shell -f    # the shell's log, including ours

hyprctl reload                   # removes every injected binding
hyprctl binds | grep -c '^bind'  # 228 clean; roughly doubled once injected
```

Useful introspection, all read-only:

```sh
hyprctl eval '<lua>'                   # run Lua in the live compositor
lua lua/registry.lua ~/.config/hypr/hyprland.lua
omarchy menu keybindings --print        # must not grow after injection
```

---

## Conventions

- **All logic in plain `.js`, QML stays thin.** Omarchy's own plugins do this
  (`IdleModel.js`, `OsdModel.js`, `BarModel.js`) — follow it. QML units do I/O and
  wiring only, because QML is what cannot be unit-tested here.
- **Every `.js` file ends with**
  `if (typeof module !== "undefined") module.exports = { ... }`
  so the same file is importable by QML and requirable by node. Do not add
  `.pragma library`; it is a syntax error under node, and Omarchy's models omit it.
- **Write ES5-flavoured JavaScript.** `var`, no arrow functions, no template
  literals, no destructuring — the QML JS engine is not the node one, and the
  house style in Omarchy's models is uniformly ES5.
- **Never hardcode a colour or a size.** Everything comes from the `Color` and
  `Style` singletons in `qs.Commons`, or the toast stops following the user's
  theme. `Color.popups.background`, `Color.popups.text`, `Style.space(n)`,
  `Style.cornerRadius`.
- **Tests are TDD, in this order:** write the failing test, run it and watch it
  fail, write the minimal implementation, run it and watch it pass, commit.
- **Minimal diffs.** Edit in place. No speculative abstractions.
- Commit messages: imperative mood, no scope prefixes, body explains *why*.

---

## Verified platform facts

Checked against Omarchy 4.0.0.alpha, Hyprland 0.56.2, Quickshell 0.3.0 on
2026-08-19. Spec §3 records the evidence for each. Do not re-derive these; do
re-verify them if a component is upgraded.

| Fact | Consequence |
|------|-------------|
| Hyprland runs **all** bindings on the same key combination | A binding can be shadowed without touching the original |
| `hyprctl keyword` is refused under the Lua config parser | Runtime binding registration goes through `hyprctl eval`, not `keyword` |
| `hyprctl eval` returns only `ok`, never a value | Introspection needs a side channel — write a file from Lua |
| `hl.bind` accepts a Lua function or an `hl.dsp.*` dispatcher at runtime | Shadow bindings cost no fork and no closure |
| `hl.dsp.event("n,d")` emits `custom>>n,d` on socket2 | The shadow reports on the stream we already read |
| A bare `hl.dsp.event(...)` only *constructs* a dispatcher | It must be bound to a key or run through `hl.dispatch` |
| `hl.on` has no keybind-executed event | Shadow bindings are mandatory, not a convenience |
| `hyprctl binds` reports Lua bindings as `dispatcher: __lua, arg: <int>` | It is useless as a registry; the source scan is the only way to semantics |
| Hyprland spawns `exec` bindings with `/bin/sh`; the shell uses `bash -lc` | A discriminator exists, but using it would mean a dotfile hook — rejected |
| `Util.execDetached` is the single choke point for menu and bar commands | One wrap covers `Menu.runAction` and `Bar.run` |
| Third-party plugins can `import qs.Commons` | Proven by `~/.config/omarchy/plugins/now-playing` |
| Bar workspace clicks dispatch the exact registry expression | Matching them is string equality, not heuristics |
| 20 of 257 Omarchy menu actions string-match a bound command | That is the real tier A menu coverage; normalising prefixes adds nothing |
| QML singleton methods are read-only; `defineProperty` is silently ignored | `Util.execDetached` cannot be wrapped. Tier A has no in-process hook — see spec §12.1 |
| `omarchy plugin validate` rejects any symlink inside the plugin folder | And the repository root *is* that folder |
| A plugin has **one** shell.json entry: `bar.layout` is searched before `plugins[]` | Reads must use the same precedence as `updateEntryInline`, or the panel saves where the service does not look |
| `isEnabled` ends in `findEntryLocation().found`, and `_syncServices` gates on it | A bar-layout entry still mounts the service — moving omakey to the bar does not kill the correlator |
| `setEnabled` inserts into the bar layout only when the plugin has no entry yet | Enabling a widget on top of an existing `plugins[]` entry is a no-op that still prints `Enabled and moved` |
| `omarchy-plugin-add` prompts for the bar section, but only when interactive and without `--yes` | Install-time placement is the CLI's job, not the plugin's |
| `barWidget.schema[]` is stored at `shell.qml:696` and never rendered | Declaring it is free; it builds no UI |
| A bar widget is injected `bar`, `moduleName`, `settings` — never `service` | Service-to-widget data has to go through a file or shell.json |
| `Bar.qml:25` exposes `property var shell` | `bar.shell.updateEntryInline` is how a widget persists its own settings |
| An anchor line cannot be cleared by assigning `undefined` | A ternary anchor leaves both members of an axis bound: the item sizes negative and paints nothing, and the stale anchor leaks into the next state. Position with `x`/`y` instead |
| `qs.Ui` exports `WidgetButton`/`BarIconButton`, and only a registered click target stops a bar click falling through to the bar's own gestures | An unregistered widget lets a double-click reach the bar background and toggle transparency |
| `qs.Ui/KeyboardPanel` is what the native bar popups are built on | It primes `WlrKeyboardFocus.Exclusive` then settles on `OnDemand`; a hand-rolled layer surface leaves a stationary second click undelivered until the pointer moves |
| Every `hl.bind` call is made from `helpers.lua` | Attributing a binding to its own file means walking the stack past it, from level 3 |
| All six bar panels open under one namespace, `omarchy-keyboard-panel`, and all eight menus under `omarchy-menu` | A shared namespace names no binding *on the wire*, and it is still never learned — a learned pairing blames every later click on whichever key fired first |
| `shell.isPluginOpen(id)` is public and routes bar-widget panels to `bar.isBarWidgetOpen`; the menu's `activeMenu` is a *private* property, reachable only off `shell.panelLoaders` | Sampled when the `openlayer` arrives, those turn the shared namespaces back into an exact binding. Sampled at promotion time instead, the user may already have walked into a submenu |
| `shell.panelEntries` holds the `panel`/`overlay`/`menu` kinds only — tailscale, weather and the agents picker are `bar-widget` plugins with a panel behind them | The candidate list for the owner sample comes from `pluginRegistry.installedPlugins`, or those three are never asked about and stay unnameable |
| A binding's command need not name the surface it raises: `omarchy-menu toggle reminder-set` opens `omarchy-reminders`, and `omarchy-agent --pick` opens the agents panel | No seed can pair those. One keypress does, and for a shared namespace it is the sampled owner that is learned, never the namespace |
| `omarchy-toggle-nightlight`, `omarchy-toggle-idle` and `omarchy-toggle-notification-silencing` emit nothing at all on socket2 | Measured 2026-08-19: five such commands produced one unrelated layer event between them. They are reachable only through a command hook, which is tier A, which does not exist |
| `omarchy-osd` and `omarchy-notifications` are ambiguous in substance, not on the wire | The OSD rises on a volume change no key caused. No amount of asking produces a key to name, so they stay refused |
| A panel that declares its own namespace uses the plugin id with dots turned into dashes (`omarchy.clipboard` → `omarchy-clipboard`) | The panel seed resolves those without waiting for a keypress to teach the pairing |
| `fullscreen>>1` carries the state, never the mode | `mode = "maximized"` cannot be told from `mode = "fullscreen"` on socket2. No mouse path maximises a window, so the gap is theoretical |
| `activespecial>>special:<name>,<monitor>` on entry, `activespecial>>,<monitor>` on exit | Only entering a special workspace can be attributed to a binding |
| No binding switches keyboard layout — `kb_layout` is an input setting | `activelayout` fires on its own from the virtual keyboard. It is noise attached to nothing, not a missing detector |
| `hyprctl dispatch <name> <args>` is refused under the Lua config parser | Driving the compositor by hand needs `hyprctl dispatch '<lua expression>'`, the same form the bar uses |
| `rescanPlugins` re-instantiates from Qt's cached compiled QML | Only `omarchy restart shell` picks up a QML edit |

**Still unverified** (spec §12): `hl.timer`'s exact signature, and whether one
keypress fires a shadow once or several times. The panel layer namespaces were
measured on 2026-08-19 and are in the table above.

Also unverified: whether the correlator's cursor-activity gate can be driven
synthetically. `hyprctl dispatch movecursor` does not satisfy it, so the
category gate is covered by unit tests rather than by an observed live
suppression. Testing it end to end needs a real pointer device.

---

## Where to look first

Most of what you need is in the installed Omarchy source, not in this repo.

| Question | Start here |
|----------|-----------|
| How does a shell plugin work? | `/usr/share/omarchy/shell/README.md`, `plugins/README.md` |
| What does a `service` plugin look like? | `/usr/share/omarchy/shell/plugins/services/battery/Service.qml` |
| How do I read Hyprland events in QML? | `/usr/share/omarchy/shell/plugins/services/idle/Service.qml:285` and `IdleModel.js:7` |
| How do I build a themed popup? | `/usr/share/omarchy/shell/plugins/osd/Osd.qml:126` |
| Which colours and sizes exist? | `/usr/share/omarchy/shell/Commons/Color.qml`, `Commons/Style.qml` |
| Where do menu and bar commands run? | `Commons/Util.qml:53`, `plugins/menu/Menu.qml:141`, `plugins/bar/Bar.qml:614` |
| How does Omarchy recover binding semantics? | `/usr/share/omarchy/bin/omarchy-menu-keybindings` |
| What do the user's bindings look like in source? | `/usr/share/omarchy/default/hypr/bindings/*.lua` |
| What is a real third-party plugin? | `~/.config/omarchy/plugins/now-playing/` |
| How do I contribute upstream? | `/usr/share/omarchy/default/agents/skills/omarchy/contributing.md` |

---

## Skills to use

- **`superpowers:brainstorming`** before any new feature or behaviour change. It
  is what produced the spec, and the design gate it enforces is why the
  architecture survived three rewrites during exploration.
- **`superpowers:test-driven-development`** for every unit under implementation.
- **`superpowers:systematic-debugging`** before proposing a fix for any bug. This
  codebase's failures are timing and attribution problems; guessing at them wastes
  more time than instrumenting them.
- **`omarchy`** for anything touching Hyprland or shell configuration semantics.
- **`/simplify`** on the diff after a non-trivial change.
- **`/code-review`** before merging anything that touches the correlator or the
  injector — those two are where a mistake reaches the user's live session.

Golden path for a non-trivial change: read the spec section that covers it, write
the failing test, implement the narrowest thing that passes, run `node --test`,
verify against the running shell, then `/simplify` the diff.

---

## Upstream

Two things omakey wants that Omarchy does not offer. Route both per
`contributing.md` — Omarchy lives at https://github.com/basecamp/omarchy, and
suggestions go to Discussions rather than Issues.

- **A shell-level "command executed" signal.** It would make tier A possible at
  all. The `Util.execDetached` wrap that was to provide it never shipped: QML
  refuses the assignment (spec §12.1), so today there is no hook.
- **A `currentMenu()` method on the menu plugin.** `Service.qml` reads the menu's
  private `activeMenu` off `shell.panelLoaders["omarchy.menu"].item` — the
  deepest reach into Omarchy in this repository. It is read-only, and it is the
  same loader walk the shell itself does for a foreign panel (`shell.qml:817`),
  raw plugin id and all, rather than the `resolveEnabledId` every other consumer
  goes through. `shell.callIfLoaded` already returns a string, so one method
  upstream would turn the walk into a supported call.
