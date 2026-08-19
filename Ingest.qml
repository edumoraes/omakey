import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland

// Reads Hyprland's socket2 and hands every event on as a plain object. Shadow
// bindings and state changes arrive on this one ordered stream, which is the
// whole reason the correlator can tell a keypress from a click.
Item {
  id: root

  signal event(var parsed)

  property bool recording: false
  property string statePath: Quickshell.env("HOME") + "/.local/state/omakey"

  property var _lines: []
  property bool _dirty: false

  // Omarchy's own idiom -- see plugins/services/idle/IdleModel.js:7. `parse`
  // splits on commas but respects the event's own field count; the fallback
  // matters for events whose payload contains a comma.
  function parts(raw) {
    try { if (raw && raw.parse) return raw.parse(8) } catch (error) {}
    return String((raw && raw.data) || "").split(",")
  }

  Connections {
    target: Hyprland
    function onRawEvent(raw) {
      var parsed = {
        name: String(raw.name || ""),
        args: root.parts(raw),
        at: Date.now()
      }
      // What the wire carried, and only that. The service stamps an `owner`
      // onto some layer events after this point, sampled from live shell state
      // that no fixture can reproduce -- so a recording replays the correlator
      // faithfully and leaves the owner path to its unit tests.
      if (root.recording) {
        root._lines.push(JSON.stringify(parsed))
        root._dirty = true
      }
      root.event(parsed)
    }
  }

  // FileView has no append: setText writes the whole file. The recorder is a
  // development tool that produces test fixtures, not a hot path, so it
  // buffers and rewrites rather than touching disk per event.
  function flush() {
    if (!root._dirty) return
    root._dirty = false
    recorder.setText(root._lines.join("\n") + "\n")
  }

  Timer {
    interval: 2000
    running: root.recording
    repeat: true
    onTriggered: root.flush()
  }

  FileView {
    id: recorder
    path: root.statePath + "/stream.jsonl"
    watchChanges: false
    atomicWrites: true
    printErrors: false
  }

  Process {
    id: ensureDir
    command: ["mkdir", "-p", root.statePath]
  }

  onRecordingChanged: {
    if (!root.recording) {
      root.flush()
      return
    }
    root._lines = []
    root._dirty = false
    ensureDir.running = true
  }
}
