# omakey

A Key Promoter for the [Omarchy](https://omarchy.org) desktop. When you do
something with the mouse that a keybinding already does, omakey tells you the
keybinding you could have pressed.

It reads the keybindings **you** have configured, not a hardcoded list, so your
own overrides in `~/.config/hypr/bindings.lua` are promoted the same as
Omarchy's defaults.

## How it works

Omarchy 4 configures Hyprland in Lua, and Hyprland runs *every* binding
registered on a key combination — not just the first. omakey uses that: at
startup it registers one extra, invisible binding beside each of yours, whose
only job is to emit a custom event on Hyprland's IPC socket.

That means the "you pressed a key" signal and the "something changed" signal
arrive on the same ordered stream. When a window closes or a workspace changes
with no keypress beside it, the mouse did it — and omakey can say which key
would have been faster.

## Install

```bash
omarchy plugin add https://github.com/edumoraes/omakey.git --enable
```

Run it without `--yes`. Omarchy asks which bar section the omakey button should
go in, and that prompt is skipped for a non-interactive install. To place it
later, or to move it:

```bash
omarchy plugin enable omakey --section right --before omarchy.tray
omarchy bar move omakey --section left
```

**Upgrading from 0.1.x.** omakey used to be a service and panel only, so its
shell.json entry sits in `plugins[]` rather than in the bar layout. Omarchy
adds a widget to the bar only when the plugin has no entry at all, so enabling
it on top of the old one does nothing -- and reports `Enabled and moved omakey`
while doing it. Disable first:

```bash
omarchy plugin disable omakey
omarchy plugin enable omakey --section right
```

## Uninstall

```bash
omarchy plugin remove omakey
hyprctl reload
```

The `hyprctl reload` is what removes the bindings omakey registered. It is also
the general escape hatch: omakey writes nothing to your Hyprland configuration,
so reloading always returns Hyprland to exactly what your own config says.

## Settings

Click the omakey button on the bar. It opens a panel with everything below --
a master switch, where hints appear, how much omakey speaks, and which
categories it speaks about.

Turning omakey off leaves its counters untouched, so switching it back on
resumes where it left off rather than starting over. The same is true of an
individual category.

Everything is stored as inline fields on omakey's entry in
`~/.config/omarchy/shell.json`, so it can also be edited by hand. The entry is
in `bar.layout` when the button is on the bar and in `plugins[]` otherwise:

```json
{ "id": "omakey", "toastPosition": "bottom-right", "intensity": "discreet" }
```

| Key | Default | What it does |
| --- | --- | --- |
| `hintsEnabled` | `true` | The master switch. Turn it off and omakey stays silent without forgetting anything it has learned. |
| `toastPosition` | `bottom-center` | Which corner or edge the hint appears at: `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`. |
| `intensity` | `balanced` | How readily omakey speaks. See below. |
| `toastDuration` | `4000` | How long the hint stays up, in milliseconds. Four stops: `2000`, `4000`, `7000`, `10000`. |
| `mutedCategories` | `[]` | Categories omakey stays quiet about. |
| `cursorIdleMs` | `800` | How recently the cursor must have moved for a window close to count as a mouse action. |
| `record` | `false` | Development aid: writes every IPC event to `~/.local/state/omakey/stream.jsonl`. |

### Intensity

One setting instead of four counters, because in practice they move together.

| | Silent for the first | Repeats no sooner than | Considers it learned after | Gives up after |
| --- | --- | --- | --- | --- |
| `discreet` | 6 uses | 5 minutes | 3 uses | 3 ignored hints |
| `balanced` | 3 uses | 1 minute | 5 uses | 5 ignored hints |
| `insistent` | 1 use | 15 seconds | 8 uses | 10 ignored hints |

`balanced` is what omakey has always done.

### Categories

omakey groups your keybindings by the file that declares them, so the list
reflects your actual configuration rather than a fixed table. On a stock
Omarchy install that is:

| Category | Bindings |
| --- | --- |
| Tiling | 100 |
| System | 72 |
| Media | 28 |
| Applications | 28 |

Tiling covers more than windows: `tiling.lua` declares every workspace and
monitor binding too.

Turning a category off silences its hints without affecting anything else --
and without spending its counters, so turning it back on starts from where it
left off. A bindings file omakey does not recognise becomes a category of its
own rather than going missing.

Right-click a hint to mute that action permanently. Left-click dismisses it.

## What it touches

- **Nothing persistent in your configuration.** No edits to `~/.config/hypr/`,
  no shell profile hooks, no `PATH` changes. Its bindings are injected at
  runtime and disappear on reload.
- **One state file**, `~/.local/state/omakey/stats.json`, holding what omakey
  has learned, the counters that let hints fade once you have picked a shortcut
  up, and the category list the settings panel reads. Delete it to start over.
- **Your preferences**, on omakey's own entry in
  `~/.config/omarchy/shell.json`. That file is Omarchy's, and omakey only ever
  writes its own entry, through the shell's own API.
- Your keybinding count in `hyprctl binds` roughly doubles while omakey is
  running — 228 becomes 456 on a default install. That is expected: those are
  the invisible companion bindings. They carry no description, so
  `omarchy menu keybindings` is unaffected, and you can confirm that:

  ```bash
  hyprctl binds | grep -c '^bind'          # doubled
  hyprctl binds | grep -c 'omakey'         # 0 — they are anonymous
  omarchy menu keybindings --print | wc -l # unchanged
  ```

## What it cannot see

Picking an entry out of the Omarchy menu with the mouse is **not** promoted.
Catching that needs a signal from the shell when it runs a command, and QML
refuses to let a plugin wrap `Util.execDetached` — singleton methods are
read-only properties, and `Object.defineProperty` does not reach a QObject's
meta-object.

Clicking a workspace in the bar *is* promoted, because that produces a real
workspace change on the IPC stream. It is the menu entries and panel toggles
that are out of reach. A suggestion asking Omarchy for a "command executed"
signal is drafted at
[`docs/upstream/2026-08-19-command-executed-signal.md`](docs/upstream/2026-08-19-command-executed-signal.md);
if it lands, menu coverage drops straight into a seam that already accepts it.

## Reporting a problem

omakey logs one line at startup saying what is actually live. Paste it into any
bug report:

```bash
journalctl --user -t omarchy-shell | grep 'omakey: capabilities'
```

```
omakey: capabilities {"registry":true,"shadows":true,"commands":false} tiers {"effects":true,"commands":false}
```

- `registry` — omakey could read your keybindings.
- `shadows` — the invisible companion bindings are live in Hyprland.
- `commands` — always `false`; see *What it cannot see* above.

If `shadows` is false, omakey goes completely silent rather than guessing:
without them there is no way to tell a keypress from a click, so every action
would look like a mouse action. Silence is the intended failure mode.

## License

MIT. See [LICENSE](LICENSE).
