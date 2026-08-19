import QtQuick
import Quickshell
import Quickshell.Io
import "PayloadModel.js" as PayloadModel

// Applies the shadow-binding payload to the live compositor through
// `hyprctl eval`. `hyprctl keyword` is refused under the Lua config parser, so
// eval is the only runtime channel -- see spec 3.2.
Item {
  id: root

  signal failed(string reason)
  signal applied(int count, bool skipped)

  property bool injected: false
  property int chunkSize: 40

  property var _bindings: []
  property var _queue: []

  function apply(bindings) {
    root._bindings = bindings || []
    if (!root._bindings.length) {
      root.failed("no bindings")
      return
    }
    root.injected = false
    counter.running = true
  }

  // Shadow bindings live in Hyprland, not in the shell: a plugin reload leaves
  // them in place. Injecting twice would stack a second shadow on every key.
  // `hyprctl eval` returns only "ok" and never a value (spec 3.2), so the bind
  // count is the one channel available: a fully injected session reports twice
  // as many binds as the registry holds.
  Process {
    id: counter
    command: ["bash", "-c", "hyprctl binds | grep -c '^bind' || true"]

    stdout: SplitParser {
      onRead: function (line) { counter.count = parseInt(String(line).trim(), 10) }
    }

    property int count: -1

    onExited: function (exitCode) {
      if (exitCode !== 0 || counter.count < 0) {
        root.failed("bind count failed")
        return
      }
      if (counter.count >= root._bindings.length * 2) {
        root.injected = true
        root.applied(0, true)
        return
      }
      root._queue = PayloadModel.buildChunks(root._bindings, root.chunkSize)
      if (!root._queue.length) {
        root.failed("no chunks")
        return
      }
      root._next()
    }
  }

  function _next() {
    if (!root._queue.length) {
      root.injected = true
      root.applied(root._bindings.length, false)
      return
    }
    var chunk = root._queue[0]
    root._queue = root._queue.slice(1)
    evaluator.command = ["hyprctl", "eval", chunk]
    evaluator.running = true
  }

  Process {
    id: evaluator
    onExited: function (exitCode) {
      if (exitCode !== 0) {
        root.failed("hyprctl eval exit " + exitCode)
        return
      }
      root._next()
    }
  }
}
