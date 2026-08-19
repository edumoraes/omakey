import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "CategoryModel.js" as CategoryModel
import "SettingsModel.js" as SettingsModel

// omakey's preferences surface. Named Widget.qml rather than BarWidget.qml
// because qs.Ui already exports a type called BarWidget: a local file of that
// name would shadow the base this very item extends.
//
// The popup is a layer-shell PanelWindow of its own rather than the bar's
// popup machinery. That machinery is first-party plumbing with no documented
// third-party contract, while this technique is already proven in Toast.qml
// next door.
BarWidget {
  id: root
  moduleName: "omakey"

  property bool opened: false

  // The bar injects this widget's inline shell.json entry as `settings`, which
  // is the same entry the service reads. Normalising through the shared model
  // is what keeps the panel and the correlator agreeing on what is configured.
  readonly property var current: SettingsModel.read(root.settings)

  // Categories are discovered by the service's scan of the user's real config,
  // so they cannot be hardcoded here. A bar widget is handed bar/moduleName/
  // settings and never the service, so the service publishes them through the
  // state file instead.
  property var categories: []

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
    onLoadFailed: root.categories = []
  }

  function adoptState(payload) {
    try {
      var parsed = JSON.parse(payload)
      root.categories = Array.isArray(parsed.categories) ? parsed.categories : []
    } catch (error) {
      root.categories = []
    }
  }

  PanelWindow {
    visible: root.opened
    color: "transparent"
    anchors { top: true; bottom: true; left: true; right: true }

    // CorrelatorModel drops openlayer events whose namespace begins with
    // "omakey", so opening this panel cannot promote itself into a hint.
    WlrLayershell.namespace: "omakey-preferences"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.OnDemand

    Item {
      anchors.fill: parent
      focus: true
      Keys.onEscapePressed: root.opened = false

      // Clicking anywhere outside the card dismisses it. The card sits above
      // this and stops the event.
      MouseArea {
        anchors.fill: parent
        onClicked: root.opened = false
      }

      Rectangle {
        id: card

        anchors.top: root.bar && root.bar.position === "bottom" ? undefined : parent.top
        anchors.bottom: root.bar && root.bar.position === "bottom" ? parent.bottom : undefined
        anchors.right: parent.right
        anchors.margins: Style.space(12)

        radius: Style.cornerRadius
        color: Color.popups.background
        border.color: Color.popups.border
        border.width: Math.max(1, Style.space(2))
        implicitWidth: layout.implicitWidth + Style.space(32)
        implicitHeight: layout.implicitHeight + Style.space(32)

        MouseArea { anchors.fill: parent }

        Column {
          id: layout
          anchors.centerIn: parent
          spacing: root.gap

          Text {
            text: "omakey"
            color: Color.popups.text
            font.family: Style.font.family
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          SectionLabel { text: "Hint position" }

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

          SectionLabel { text: "How much it speaks" }

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

          SectionLabel { text: "Categories" }

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
              label: modelData.label
              count: modelData.count
              muted: CategoryModel.isMuted(root.current.mutedCategories, modelData.id)
              onToggled: root.toggleCategory(modelData.id)
            }
          }
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

  component CategoryRow: Item {
    id: row
    property string label: ""
    property int count: 0
    property bool muted: false
    signal toggled()

    implicitWidth: Math.max(rowText.implicitWidth + countText.implicitWidth + Style.space(48), Style.space(180))
    implicitHeight: rowText.implicitHeight + Style.space(8)

    Rectangle {
      anchors.verticalCenter: parent.verticalCenter
      anchors.left: parent.left
      width: Style.space(10)
      height: Style.space(10)
      radius: width / 2
      color: row.muted ? "transparent" : Color.popups.text
      border.color: Color.popups.border
      border.width: Math.max(1, Style.space(1))
    }

    Text {
      id: rowText
      anchors.verticalCenter: parent.verticalCenter
      anchors.left: parent.left
      anchors.leftMargin: Style.space(18)
      text: row.label
      color: Color.popups.text
      opacity: row.muted ? 0.5 : 1.0
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }

    Text {
      id: countText
      anchors.verticalCenter: parent.verticalCenter
      anchors.right: parent.right
      text: String(row.count)
      color: Color.popups.text
      opacity: 0.5
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }

    MouseArea {
      anchors.fill: parent
      onClicked: row.toggled()
    }
  }
}
