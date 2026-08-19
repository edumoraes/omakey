import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import "ToastModel.js" as ToastModel

// The hint itself. Summoned by the service through shell.summon("omakey", ...),
// which queues the payload and calls open() on this item.
Item {
  id: root

  property var shell: null
  // The shell hands a panel its own plugin's service when it declares this
  // property (shell.qml:636), which is how the mute click reaches the policy.
  property var service: null

  property bool opened: false
  property string combo: ""
  property string description: ""
  property string actionKey: ""
  property string position: "bottom-center"
  property int duration: 4000

  readonly property int pad: Style.space(16)

  function open(payloadJson) {
    var payload = {}
    try { payload = JSON.parse(payloadJson || "{}") } catch (error) { return }
    root.combo = String(payload.combo || "")
    root.description = String(payload.description || "")
    root.actionKey = String(payload.actionKey || "")
    // The service normalises this through SettingsModel, so an unrecognised
    // value never reaches here; the guard is for a payload from anywhere else.
    root.position = String(payload.position || "bottom-center")
    if (!root.combo) return
    root.opened = true
    hideTimer.restart()
  }

  function close() {
    root.opened = false
    hideTimer.stop()
  }

  Timer {
    id: hideTimer
    interval: root.duration
    onTriggered: root.close()
  }

  PanelWindow {
    visible: root.opened
    color: "transparent"
    anchors { top: true; bottom: true; left: true; right: true }

    // This namespace is why CorrelatorModel drops openlayer events beginning
    // with "omakey": otherwise showing a hint would promote itself, which would
    // show another hint.
    WlrLayershell.namespace: "omakey-toast"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore

    // The surface spans the screen so the card can be positioned against it,
    // but only the card accepts input. Without this the toast would swallow
    // every click on the desktop for the four seconds it is up.
    mask: Region { item: card }

    Rectangle {
      id: card

      // Placed by arithmetic, not by anchors. See ToastModel: an anchor line
      // cannot be cleared by assigning undefined, so the ternary form left both
      // members of an axis bound, sized the card negative, and leaked the
      // leftover anchors into the next position shown.
      readonly property var origin: ToastModel.origin(root.position,
        parent.width, parent.height, width, height, Style.space(67))
      x: origin.x
      y: origin.y

      radius: Style.cornerRadius
      color: Color.popups.background
      border.color: Color.popups.border
      border.width: Math.max(1, Style.space(2))
      implicitWidth: column.implicitWidth + root.pad * 2
      implicitHeight: column.implicitHeight + root.pad * 2

      Column {
        id: column
        anchors.centerIn: parent
        spacing: Style.space(4)

        Text {
          anchors.horizontalCenter: parent.horizontalCenter
          text: root.combo
          color: Color.popups.text
          font.family: Style.font.family
          font.pixelSize: Style.font.display
          font.bold: true
        }

        Text {
          anchors.horizontalCenter: parent.horizontalCenter
          // Two of the user's 228 bindings carry no description.
          visible: text !== ""
          text: root.description
          color: Color.popups.text
          opacity: 0.7
          font.family: Style.font.family
          font.pixelSize: Style.font.subtitle
        }
      }

      MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onClicked: function (mouse) {
          if (mouse.button === Qt.RightButton && root.service && root.actionKey) {
            root.service.mute(root.actionKey)
          }
          root.close()
        }
      }
    }
  }
}
