# Upstream suggestion: a signal when the shell runs a command

**Where to post:** https://github.com/basecamp/omarchy/discussions/categories/suggestions
(per `default/agents/skills/omarchy/contributing.md`, feature ideas go to
Discussions, not Issues.)

**Status:** drafted, not posted. Nothing goes out without the maintainer's review.

---

## Title

Let shell plugins observe commands the shell runs on the user's behalf

## Body

Third-party shell plugins can see almost everything about the desktop except one
thing: what the user just asked the shell to do. Menu entries and bar widgets run
their actions through `Commons/Util.qml`'s `execDetached`, and there is no way for
a plugin to know it happened.

I would like to suggest emitting a signal there.

### Where everything converges

In 4.0.0.alpha, `Util.execDetached(command)` runs `["bash", "-lc", command]` and
is called from both sides of the shell's user-facing surface:

- `plugins/menu/Menu.qml` — `runAction()`, so every Omarchy menu entry
- `plugins/bar/Bar.qml` — `run()`, used by Workspaces, KeyboardLayout,
  Microphone, SystemUpdate, Dictation, ScreenRecording, and custom modules

That single function is already the choke point. It is not quite universal —
`plugins/panels/audio/Panel.qml`, for instance, calls `Quickshell.execDetached`
directly — but it covers the paths a plugin would actually care about.

Some of those calls even carry perfectly structured intent.
`plugins/bar/widgets/Workspaces.qml` dispatches
`hyprctl dispatch 'hl.dsp.focus({ workspace = "3" })'` — the exact expression the
user's keybinding holds.

### Why a plugin cannot get at it today

QML exposes singleton methods as read-only properties. Measured against
Omarchy 4.0.0.alpha with Quickshell 0.3.0:

| Attempt | Result |
| --- | --- |
| `Util.execDetached = wrapper` | `TypeError: Cannot assign to read-only property "execDetached"` |
| `Object.defineProperty(Util, "execDetached", …)` | does not throw — silently ignored |
| `Quickshell.execDetached = wrapper` | `TypeError: Cannot assign to read-only property "execDetached"` |

The alternatives all reach outside the plugin's own directory: watching process
creation needs root or polling, and a shell-profile hook means writing to the
user's dotfiles. For a plugin that is installed with one command and should
uninstall just as cleanly, neither is acceptable.

### The suggestion

Something as small as this, if a signal fits the "pure functions only" rule that
`Util.qml`'s header states:

```qml
signal commandExecuted(string command)

function execDetached(command) {
  Quickshell.execDetached(["bash", "-lc", command])
  root.commandExecuted(command)
}
```

If `Util` should stay strictly pure, a tiny `Commons/CommandBus.qml` singleton
carrying the signal would work just as well, with `execDetached` emitting through
it.

Either shape is additive: no behaviour change, no new IPC surface, no new config
key, and nothing to maintain beyond one emit.

### What it would unlock

My own case is a Key Promoter — it watches for actions done with the mouse and
shows the keybinding that would have done the same thing, reading the user's own
configured bindings. Everything else already works through Hyprland's event
stream; the Omarchy menu is the one surface that leaves no trace, so a menu entry
that has a shortcut cannot be promoted.

It generalises past that, though. Anything that wants to react to what the user
asked the shell to do — usage analytics, macro recording, a "recent actions"
widget, a plugin that mirrors shell actions somewhere else — needs the same
signal.

Happy to send the PR if the idea is welcome, in whichever of the two shapes you
prefer.
