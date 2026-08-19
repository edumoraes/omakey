# CLAUDE.md — omakey

> A Key Promoter for the Omarchy desktop: when you do something with the mouse
> that a keybinding already does, it shows you the keybinding. This file tells
> AI agents what is decided, what is verified, and what will break the user's
> session if you get it wrong.

## Status

**Designed and planned; no implementation yet.** The repository currently holds
two documents and nothing else:

- `docs/superpowers/specs/2026-08-19-omakey-key-promoter-design.md` — the design,
  including every platform fact that was verified rather than assumed.
- `docs/superpowers/plans/2026-08-19-omakey.md` — twelve tasks, each ending in a
  tested, committable deliverable.

Read the spec before the plan, and both before writing code. The architecture map
below describes files the plan *will* create; do not assume any of them exist.

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
6. **No emojis** in code, docs, or commits unless asked for.

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
| `CommandHook.qml` | Wraps `Util.execDetached` to catch menu and bar commands |
| `Store.qml` | Loads and saves `~/.local/state/omakey/stats.json` |
| `Toast.qml` | `panel` entry point. The hint UI, layer namespace `omakey-toast` |
| `RegistryModel.js` | Parse scanner TSV into binding objects |
| `PayloadModel.js` | Build the Lua payload for `hyprctl eval` |
| `CorrelatorModel.js` | Grace window, three-input decision |
| `MapperModel.js` | Effect → candidate binding (dispatcher seed plus learned) |
| `PolicyModel.js` | Adaptive policy, counters, tier gating |
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
# Install the working copy as a plugin. Editing the repo reloads the plugin.
ln -sfn "$PWD" ~/.config/omarchy/plugins/omakey
omarchy-shell shell rescanPlugins
omarchy plugin enable omakey

omarchy plugin validate .        # the manifest contract; run before loading
node --test tests/               # all logic is plain JS, so this covers it
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

**Still unverified** (spec §12): whether a QML singleton method can be reassigned
from a plugin, `hl.timer`'s exact signature, the panel layer namespaces, and
whether one keypress fires a shadow once or several times.

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

The `Util.execDetached` wrap is the one place omakey reaches into Omarchy's
internals. An upstream pull request adding a shell-level "command executed"
signal would let it be deleted. Worth opening in parallel with implementation;
route it per `contributing.md` — Omarchy lives at
https://github.com/basecamp/omarchy, and suggestions go to Discussions rather
than Issues.
