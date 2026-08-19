# omakey

A Key Promoter for the [Omarchy](https://omarchy.org) desktop. When you do
something with the mouse that a keybinding already does, omakey tells you the
keybinding you could have pressed.

It reads the keybindings **you** have configured, not a hardcoded list, so your
own overrides in `~/.config/hypr/bindings.lua` are promoted the same as
Omarchy's defaults.

> **Status: not usable yet.** The design and implementation plan are complete and
> the first spike has run; the plugin itself is not built. See
> [`docs/superpowers/specs/`](docs/superpowers/specs/) for the design and
> [`docs/superpowers/plans/`](docs/superpowers/plans/) for what remains.

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

## What it touches

- **Nothing persistent in your configuration.** No edits to `~/.config/hypr/`,
  no shell profile hooks, no `PATH` changes. Its bindings are injected at
  runtime and disappear on reload.
- **One state file**, `~/.local/state/omakey/stats.json`, holding the counters
  that let hints fade once you have learned a shortcut. Delete it to start over.
- Your keybinding count in `hyprctl binds` roughly doubles while omakey is
  running. That is expected — those are the invisible companion bindings. They
  carry no description, so `omarchy menu keybindings` is unaffected.

## License

MIT. See [LICENSE](LICENSE).
