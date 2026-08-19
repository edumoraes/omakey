import QtQuick
import Quickshell
import Quickshell.Io
import "PayloadModel.js" as PayloadModel

// Applies omakey's Lua payloads to the live compositor through `hyprctl eval`.
// `hyprctl keyword` is refused under the Lua config parser, so eval is the only
// runtime channel -- see spec 3.2.
Item {
  id: root

  signal failed(string reason)
  signal applied(int count, bool skipped)

  property bool injected: false
  property int chunkSize: 40
  property string pluginPath: ""

  property var _bindings: []
  property var _queue: []
  property bool _skipped: false

  function apply(bindings) {
    root._bindings = bindings || []
    if (!root._bindings.length) {
      root.failed("no bindings")
      return
    }
    root.injected = false
    root._skipped = false
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

    property int count: -1

    stdout: SplitParser {
      onRead: function (line) { counter.count = parseInt(String(line).trim(), 10) }
    }

    onExited: function (exitCode) {
      if (exitCode !== 0 || counter.count < 0) {
        root.failed("bind count failed")
        return
      }
      if (counter.count >= root._bindings.length * 2) {
        root._skipped = true
        root._applyCursor()
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

  // The `--` is not decoration: hyprctl parses a leading `--` in the payload as
  // its own flag, so any Lua whose first line is a comment reaches it as a
  // usage error rather than as code.
  function _next() {
    if (!root._queue.length) {
      root._applyCursor()
      return
    }
    var chunk = root._queue[0]
    root._queue = root._queue.slice(1)
    evaluator.command = ["hyprctl", "eval", "--", chunk]
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

  // The cursor poller guards itself with a sentinel global in the compositor's
  // Lua VM, so it is applied on every pass -- including the one that skips the
  // bindings -- and a second application is a no-op.
  function _applyCursor() {
    var payload = cursorFile.text()
    if (!payload) {
      console.warn("omakey: cursor payload unreadable, tier C stays gated shut")
      root._finish()
      return
    }
    cursorEval.command = ["hyprctl", "eval", "--", payload]
    cursorEval.running = true
  }

  function _finish() {
    root.injected = true
    root.applied(root._skipped ? 0 : root._bindings.length, root._skipped)
  }

  FileView {
    id: cursorFile
    path: root.pluginPath ? root.pluginPath + "/lua/cursor.lua" : ""
    watchChanges: false
    printErrors: false
  }

  Process {
    id: cursorEval
    onExited: function (exitCode) {
      if (exitCode !== 0) console.warn("omakey: cursor poller eval exit", exitCode)
      root._finish()
    }
  }
}
