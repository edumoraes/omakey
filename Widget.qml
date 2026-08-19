import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "CategoryModel.js" as CategoryModel
import "PolicyModel.js" as PolicyModel
import "SettingsModel.js" as SettingsModel

// omakey's preferences surface. Named Widget.qml rather than BarWidget.qml
// because qs.Ui already exports a type called BarWidget: a local file of that
// name would shadow the base this very item extends.
//
// The popup is built on qs.Ui's KeyboardPanel, the same component Omarchy's own
// bar popups use. A hand-rolled PanelWindow looked equivalent and was not: see
// the note on the KeyboardPanel below.
BarWidget {
  id: root
  moduleName: "omakey"

  property bool opened: false

  // KeyboardPanel.close() routes here when the user dismisses by clicking
  // outside or pressing Escape.
  function close() { root.opened = false }

  // The bar injects this widget's inline shell.json entry as `settings`, which
  // is the same entry the service reads. Normalising through the shared model
  // is what keeps the panel and the correlator agreeing on what is configured.
  readonly property var current: SettingsModel.read(root.settings)

  // Categories are discovered by the service's scan of the user's real config,
  // so they cannot be hardcoded here. A bar widget is handed bar/moduleName/
  // settings and never the service, so the service publishes them through the
  // state file instead.
  property var categories: []
  // How many actions omakey is scheduling right now. It is what the reset
  // button is offering to discard, so the panel says it before asking.
  property int tracked: 0

  readonly property int gap: Style.space(8)

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function persist(changes) {
    var shell = root.bar ? root.bar.shell : null
    if (!shell || typeof shell.updateEntryInline !== "function") {
      // Saying so beats pretending it saved: the popup would show a choice the
      // service never receives.
      console.warn("omakey: cannot persist settings, shell.updateEntryInline unavailable")
      return
    }
    shell.updateEntryInline("omakey", SettingsModel.merge(root.settings, changes))
  }

  function setPosition(position) { root.persist({ toastPosition: position }) }
  function setIntensity(intensity) { root.persist({ intensity: intensity }) }
  function setDuration(duration) { root.persist({ toastDuration: duration }) }
  function setHintsEnabled(value) { root.persist({ hintsEnabled: value }) }
  // The reset travels as a timestamp on the shared shell.json entry: a bar
  // widget is never handed the service, and the state file belongs to the
  // service, which debounces its own writes -- clearing it from here would race
  // that. The service watches for the stamp and does the clearing itself.
  function resetLearning() { root.persist({ resetAt: Date.now() }) }

  function toggleCategory(categoryId) {
    root.persist({ mutedCategories: SettingsModel.toggleCategory(root.current.mutedCategories, categoryId) })
  }

  // BarIconButton rather than a Text plus a MouseArea of our own. The bar wraps
  // every widget slot in its own MouseArea and routes the click through
  // pressModuleClickTarget, which only finds targets that registered
  // themselves -- and WidgetButton is what registers. A plain MouseArea leaves
  // the click unaccepted, so it falls through to the bar's own gestures: two
  // quick clicks on this icon reached the bar background as a double-click and
  // toggled bar transparency, while the second click never arrived here to
  // close the popup. Both symptoms, one cause.
  //
  // Extending it also brings the open-state indicator the native widgets have:
  // `active` paints the glyph in bar.urgent.
  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰌌"
    active: root.opened
    // The bar's urgent colour is red, which reads as a warning rather than as
    // "this panel is open". The glyph stays in the bar foreground instead.
    useActiveColor: false
    // A muted category is a state the user chose and can forget about, so the
    // icon carries it rather than leaving the bar silent about it.
    dimmed: root.current.mutedCategories.length > 0
    tooltipText: "omakey preferences"
    onPressed: function (mouseButton) {
      if (mouseButton === Qt.LeftButton) root.opened = !root.opened
    }
  }

  // The service rewrites this file on every registry scan. watchChanges keeps
  // the category list current without the widget having to poll or rescan.
  FileView {
    id: state
    path: SettingsModel.stateFile(Quickshell.env("HOME"))
    watchChanges: true
    printErrors: false
    onLoaded: root.adoptState(text())
    onFileChanged: reload()
    onLoadFailed: root.adoptState("")
  }

  function adoptState(payload) {
    try {
      var parsed = JSON.parse(payload)
      root.categories = Array.isArray(parsed.categories) ? parsed.categories : []
      root.tracked = PolicyModel.trackedCount(parsed.stats)
    } catch (error) {
      root.categories = []
      root.tracked = 0
    }
  }

  // KeyboardPanel is the component Omarchy's own bar popups are built on, and
  // adopting it replaced a hand-rolled PanelWindow that was subtly wrong on
  // this compositor: a stationary second click on the button did nothing at
  // all. Its comments name the reason -- a layer surface has to prime
  // WlrKeyboardFocus.Exclusive and then settle on OnDemand, or Hyprland keeps
  // routing pointer events past the surfaces below until the cursor moves.
  //
  // It also covers the full screen and masks the bar strip back out, so a
  // click on this button while the panel is open reaches the button instead of
  // being swallowed. Getting that combination right by hand is what three
  // attempts here failed to do.
  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    // KeyboardPanel names its surface "omarchy-keyboard-panel". That has to be
    // overridden here: CorrelatorModel drops openlayer events whose namespace
    // starts with "omakey" (CorrelatorModel.js:87), and without the prefix,
    // opening this very panel with the mouse becomes an effect omakey can
    // promote into a hint about itself.
    //
    // The cost is Omarchy's `no_anim` layer rule, which matches the native
    // namespace exactly (default/hypr/apps/omarchy-shell.lua:10), so this panel
    // gets the compositor's default layer animation on top of the card's own
    // fade. A cosmetic difference, traded for not hinting at itself.
    WlrLayershell.namespace: "omakey-preferences"

    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(layout.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()

      Column {
        id: layout
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: root.gap

        Item {
          width: layout.width
          implicitHeight: Math.max(title.implicitHeight, masterSwitch.implicitHeight)

          Text {
            id: title
            anchors.verticalCenter: parent.verticalCenter
            anchors.left: parent.left
            text: "omakey"
            color: Color.popups.text
            font.family: Style.font.family
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          // The master switch sits with the title rather than in a section of
          // its own: it governs everything below, and putting it first says so.
          ToggleSwitch {
            id: masterSwitch
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            checked: root.current.hintsEnabled
            onToggled: root.setHintsEnabled(!root.current.hintsEnabled)
          }
        }

        SectionLabel { text: "Hint position"; opacity: root.current.hintsEnabled ? 0.6 : 0.3 }

        Grid {
          columns: 3
          spacing: Style.space(4)
          Repeater {
            model: SettingsModel.POSITIONS
            ChoiceChip {
              label: SettingsModel.positionLabel(modelData)
              selected: root.current.toastPosition === modelData
              onPicked: root.setPosition(modelData)
            }
          }
        }

        SectionLabel { text: "How much it speaks"; opacity: root.current.hintsEnabled ? 0.6 : 0.3 }

        Row {
          spacing: Style.space(4)
          Repeater {
            model: SettingsModel.INTENSITIES
            ChoiceChip {
              label: SettingsModel.intensityLabel(modelData)
              selected: root.current.intensity === modelData
              onPicked: root.setIntensity(modelData)
            }
          }
        }

        SectionLabel { text: "How long it stays"; opacity: root.current.hintsEnabled ? 0.6 : 0.3 }

        Item {
          width: layout.width
          implicitHeight: Math.max(dwell.implicitHeight, dwellLabel.implicitHeight)

          // qs.Ui's own slider, index-based and notched, exactly as the display
          // panel drives its text-size stops (panels/monitor/Panel.qml:699).
          PanelSlider {
            id: dwell
            bar: root.bar
            anchors.verticalCenter: parent.verticalCenter
            anchors.left: parent.left
            anchors.right: dwellLabel.left
            anchors.rightMargin: Style.space(10)
            minimum: 0
            maximum: SettingsModel.DURATIONS.length - 1
            step: 1
            integer: true
            tickCount: SettingsModel.DURATIONS.length
            value: SettingsModel.durationIndex(root.current.toastDuration)
            // Released, not moved: a drag emits a sample per pointer event, and
            // each one here would be a rewrite of shell.json. liveValue keeps
            // the knob under the cursor in the meantime.
            onReleased: function (position) { root.setDuration(SettingsModel.DURATIONS[Math.round(position)]) }
          }

          Text {
            id: dwellLabel
            anchors.verticalCenter: parent.verticalCenter
            anchors.right: parent.right
            text: SettingsModel.durationLabel(dwell.dragging
              ? SettingsModel.DURATIONS[Math.round(dwell.liveValue)]
              : root.current.toastDuration)
            color: Color.popups.text
            opacity: 0.7
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
          }
        }

        SectionLabel { text: "Categories"; opacity: root.current.hintsEnabled ? 0.6 : 0.3 }

        Text {
          visible: root.categories.length === 0
          text: "No bindings scanned yet"
          color: Color.popups.text
          opacity: 0.6
          font.family: Style.font.family
          font.pixelSize: Style.font.bodySmall
        }

        Repeater {
          model: root.categories
          CategoryRow {
            width: layout.width
            label: modelData.label
            count: modelData.count
            muted: CategoryModel.isMuted(root.current.mutedCategories, modelData.id)
            interactive: root.current.hintsEnabled
            onToggled: root.toggleCategory(modelData.id)
          }
        }

        SectionLabel { text: "Learning" }

        SectionLabel { topPadding: 0; text: PolicyModel.learningLabel(root.tracked) }

        // Spacing a hint out is the whole point of the schedule, so the way
        // back has to be here: this forgets every interval omakey has built up
        // and starts the shortcuts over at the first step. The effect-to-binding
        // map is left alone -- that is omakey's own calibration, not the user's
        // progress with a keyboard.
        ResetButton {
          width: layout.width
          enabled: root.tracked > 0
          onConfirmed: root.resetLearning()
        }
      }
    }
  }

  component SectionLabel: Text {
    color: Color.popups.text
    opacity: 0.6
    topPadding: Style.space(6)
    font.family: Style.font.family
    font.pixelSize: Style.font.bodySmall
  }

  component ChoiceChip: Rectangle {
    id: chip
    property string label: ""
    property bool selected: false
    signal picked()

    implicitWidth: Math.max(chipText.implicitWidth + Style.space(16), Style.space(56))
    implicitHeight: chipText.implicitHeight + Style.space(10)
    radius: Style.cornerRadius
    color: chip.selected ? Color.popups.text : "transparent"
    border.color: Color.popups.border
    border.width: Math.max(1, Style.space(1))

    Text {
      id: chipText
      anchors.centerIn: parent
      text: chip.label
      color: chip.selected ? Color.popups.background : Color.popups.text
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }

    MouseArea {
      anchors.fill: parent
      onClicked: chip.picked()
    }
  }

  // Two clicks rather than a dialog. The reset cannot be undone, and a modal
  // over a layer-shell popup would take the keyboard focus this panel already
  // holds -- so the button asks for itself instead: the second click has to
  // land while it is still saying so, and the question expires on its own if
  // the user moves on.
  //
  // qs.Ui's Button rather than a Rectangle of our own: it is where the hover,
  // pressed and focus fills come from, and those are theme tokens the panel's
  // hand-rolled chips do not get.
  component ResetButton: Button {
    id: reset
    property bool confirming: false
    signal confirmed()

    text: reset.confirming ? "Click again to forget everything" : "Reset learning"
    bordered: true
    focusable: true
    selected: reset.confirming
    foreground: Color.popups.text
    fontSize: Style.font.bodySmall
    opacity: reset.enabled ? 1.0 : 0.4

    onClicked: {
      if (reset.confirming) {
        reset.confirming = false
        reset.confirmed()
      } else {
        reset.confirming = true
        expiry.restart()
      }
    }

    Timer {
      id: expiry
      interval: 4000
      onTriggered: reset.confirming = false
    }
  }

  component CategoryRow: Item {
    id: row
    property string label: ""
    property int count: 0
    property bool muted: false
    property bool interactive: true
    signal toggled()

    implicitHeight: Math.max(rowText.implicitHeight, rowSwitch.implicitHeight) + Style.space(4)

    Text {
      id: rowText
      anchors.verticalCenter: parent.verticalCenter
      anchors.left: parent.left
      text: row.label
      color: Color.popups.text
      opacity: row.interactive ? (row.muted ? 0.5 : 1.0) : 0.3
      font.family: Style.font.family
      font.pixelSize: Style.font.body
    }

    Text {
      id: countText
      anchors.verticalCenter: parent.verticalCenter
      anchors.right: rowSwitch.left
      anchors.rightMargin: Style.space(10)
      text: String(row.count)
      color: Color.popups.text
      opacity: row.interactive ? 0.5 : 0.3
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }

    ToggleSwitch {
      id: rowSwitch
      anchors.verticalCenter: parent.verticalCenter
      anchors.right: parent.right
      checked: !row.muted
      interactive: row.interactive
      onToggled: row.toggled()
    }
  }
}
