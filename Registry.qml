import QtQuick
import Quickshell
import Quickshell.Io
import "RegistryModel.js" as RegistryModel

// Runs the Lua scanner over the user's Hyprland config and exposes the result
// as binding objects. The scan happens in a sandbox, in a separate process:
// nothing it evaluates reaches the compositor.
Item {
  id: root

  signal loaded(var bindings)
  signal failed(string reason)

  property string configPath: Quickshell.env("HOME") + "/.config/hypr/hyprland.lua"
  property string pluginPath: ""
  property var bindings: []

  property string _buffer: ""

  function refresh() {
    if (scanner.running) return
    if (!root.pluginPath) {
      root.failed("plugin path unknown")
      return
    }
    root._buffer = ""
    scanner.command = ["lua", root.pluginPath + "/lua/registry.lua", root.configPath]
    scanner.running = true
  }

  Process {
    id: scanner

    stdout: SplitParser {
      onRead: function (line) { root._buffer += line + "\n" }
    }

    stderr: SplitParser {
      onRead: function (line) { console.warn("omakey: registry:", line) }
    }

    onExited: function (exitCode) {
      if (exitCode !== 0) {
        root.failed("scanner exit " + exitCode)
        return
      }
      var parsed = RegistryModel.parseRegistry(root._buffer)
      if (!parsed.length) {
        root.failed("empty registry")
        return
      }
      root.bindings = parsed
      root.loaded(parsed)
    }
  }
}
