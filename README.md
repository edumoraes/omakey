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
omarchy plugin add https://github.com/<owner>/omakey.git --enable
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

Settings are inline fields on omakey's entry in `~/.config/omarchy/shell.json`:

```json
{ "plugins": [ { "id": "omakey", "quietFirst": 3, "cooldownMs": 60000 } ] }
```

| Key | Default | What it does |
| --- | --- | --- |
| `quietFirst` | `3` | How many times you may do something with the mouse before omakey says anything about it. |
| `cooldownMs` | `60000` | Minimum gap between two hints for the *same* action. |
| `learnedAfter` | `5` | Once you have used a binding this many times, omakey stops mentioning it. |
| `giveUpAfter` | `5` | A hint shown this many times and never adopted mutes itself for good. |
| `cursorIdleMs` | `800` | How recently the cursor must have moved for a window close to count as a mouse action. |
| `record` | `false` | Development aid: writes every IPC event to `~/.local/state/omakey/stream.jsonl`. |

Right-click a hint to mute that action permanently. Left-click dismisses it.

## What it touches

- **Nothing persistent in your configuration.** No edits to `~/.config/hypr/`,
  no shell profile hooks, no `PATH` changes. Its bindings are injected at
  runtime and disappear on reload.
- **One state file**, `~/.local/state/omakey/stats.json`, holding what omakey
  has learned and the counters that let hints fade once you have picked a
  shortcut up. Delete it to start over.
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
