import QtQuick
import Quickshell
import qs.Commons

Item {
  id: root

  property var shell: null

  // Spec section 12 question 1: QML singleton methods may not be reassignable
  // from JavaScript. Tier A -- 20 Omarchy menu entries and 6 bar call sites --
  // depends on the answer. Probe it, report it, and leave no trace either way.
  function probeCommandHook() {
    var original = null

    try {
      original = Util.execDetached
    } catch (error) {
      console.log("omakey: probe: Util.execDetached unreadable:", error)
      return
    }

    if (typeof original !== "function") {
      console.log("omakey: probe: Util.execDetached is not a function:", typeof original)
      return
    }

    var called = false

    try {
      Util.execDetached = function (command) {
        called = true
        return original(command)
      }
    } catch (error) {
      console.log("omakey: probe: assignment threw:", error)
      root.probeAlternatives(original)
      return
    }

    var wrapped = Util.execDetached !== original
    console.log("omakey: probe: assignment kept =", wrapped)

    if (wrapped) {
      Util.execDetached("true")
      console.log("omakey: probe: wrapper invoked =", called)
    }

    try {
      Util.execDetached = original
      console.log("omakey: probe: restored =", (Util.execDetached === original))
    } catch (error) {
      console.log("omakey: probe: restore threw:", error)
    }
  }

  // Plain assignment is refused because QML exposes singleton methods as
  // read-only properties. Two cheaper-than-redesign alternatives, before
  // declaring tier A unreachable.
  function probeAlternatives(original) {
    try {
      Object.defineProperty(Util, "execDetached", {
        value: function (command) { return original(command) },
        writable: true,
        configurable: true
      })
      console.log("omakey: probe: defineProperty kept =", (Util.execDetached !== original))
    } catch (error) {
      console.log("omakey: probe: defineProperty threw:", error)
    }

    try {
      var quickshellOriginal = Quickshell.execDetached
      Quickshell.execDetached = function (argv) { return quickshellOriginal(argv) }
      console.log("omakey: probe: Quickshell.execDetached kept =",
        (Quickshell.execDetached !== quickshellOriginal))
    } catch (error) {
      console.log("omakey: probe: Quickshell.execDetached threw:", error)
    }
  }

  Component.onCompleted: probeCommandHook()
}
