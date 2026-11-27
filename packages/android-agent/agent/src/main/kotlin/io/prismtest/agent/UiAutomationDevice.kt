package io.prismtest.agent

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.UiAutomation
import android.content.Context
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.Display
import android.view.InputDevice
import android.view.MotionEvent
import android.view.Surface
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeoutException

/**
 * [DeviceBackend] on `UiAutomation`, following protocol.md 9.1: trees come from
 * `UiAutomation.getWindows()` / `AccessibilityNodeInfo` directly (never
 * `UiDevice.dumpWindowHierarchy`, which waits for idle), and taps are injected with
 * `UiAutomation.injectInputEvent`, never `UiObject2.click()`.
 */
class UiAutomationDevice(private val ua: UiAutomation, context: Context) : DeviceBackend {
    private val display: Display = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)

    @Volatile private var lastChangeMs = 0L

    init {
        // FLAG_RETRIEVE_INTERACTIVE_WINDOWS is required for getWindows() (protocol.md 2.7).
        // FLAG_REPORT_VIEW_IDS fills viewIdResourceName (testId). FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        // keeps layout nodes, as `uiautomator dump` does without compression.
        val info = ua.serviceInfo
        info.flags = info.flags or
            AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
            AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
            AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
        ua.serviceInfo = info
        ua.setOnAccessibilityEventListener { e ->
            when (e.eventType) {
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
                AccessibilityEvent.TYPE_WINDOWS_CHANGED,
                AccessibilityEvent.TYPE_VIEW_SCROLLED,
                -> lastChangeMs = SystemClock.uptimeMillis()
            }
        }
    }

    override fun deviceInfo(): DeviceInfo = DeviceInfo(
        osVersion = Build.VERSION.RELEASE,
        apiLevel = Build.VERSION.SDK_INT,
        model = Build.MODEL,
        emulator = isEmulator(),
        locale = Locale.getDefault().toLanguageTag(),
        timeZone = TimeZone.getDefault().id,
    )

    override fun screen(): ScreenInfo {
        val dm = DisplayMetrics()
        @Suppress("DEPRECATION") // getRealMetrics is the simplest API that covers 29..35.
        display.getRealMetrics(dm)
        val rotation = when (display.rotation) {
            Surface.ROTATION_90 -> 90
            Surface.ROTATION_180 -> 180
            Surface.ROTATION_270 -> 270
            else -> 0
        }
        return ScreenInfo(dm.widthPixels, dm.heightPixels, dm.density, rotation)
    }

    // On API 29 getWindows() already covers only the default display; the filter matters from 30.
    override fun windows(): List<A11yWindow> =
        ua.windows
            .filter { displayIdOf(it) == Display.DEFAULT_DISPLAY }
            .sortedBy { it.layer }
            .map { AndroidWindow(it) }

    override fun lastContentChangeMs(): Long = lastChangeMs

    override fun uptimeMs(): Long = SystemClock.uptimeMillis()

    override fun waitForIdle(quietMs: Long, maxWaitMs: Long): Boolean = try {
        ua.waitForIdle(quietMs, maxWaitMs)
        true
    } catch (_: TimeoutException) {
        false
    }

    override fun tap(xPx: Float, yPx: Float, downMs: Long) {
        val downTime = SystemClock.uptimeMillis()
        inject(MotionEvent.ACTION_DOWN, downTime, downTime, xPx, yPx)
        if (downMs > 0) SystemClock.sleep(downMs)
        inject(MotionEvent.ACTION_UP, downTime, SystemClock.uptimeMillis(), xPx, yPx)
    }

    private fun inject(action: Int, downTime: Long, eventTime: Long, x: Float, y: Float) {
        val ev = MotionEvent.obtain(downTime, eventTime, action, x, y, 1f, 1f, 0, 1f, 1f, 0, 0)
        ev.source = InputDevice.SOURCE_TOUCHSCREEN
        try {
            if (!ua.injectInputEvent(ev, true)) {
                throw IllegalStateException("UiAutomation.injectInputEvent returned false for action $action")
            }
        } finally {
            ev.recycle()
        }
    }

    private fun isEmulator(): Boolean =
        Build.FINGERPRINT.startsWith("generic") ||
            Build.FINGERPRINT.contains("emulator") ||
            Build.HARDWARE == "goldfish" || Build.HARDWARE == "ranchu" ||
            Build.PRODUCT.startsWith("sdk") || Build.PRODUCT.contains("emulator") ||
            Build.MODEL.startsWith("sdk_gphone")

    private class AndroidWindow(private val w: AccessibilityWindowInfo) : A11yWindow {
        override val id: Int get() = w.id
        override val layer: Int get() = w.layer
        override val kind: WindowKind
            get() = when (w.type) {
                AccessibilityWindowInfo.TYPE_APPLICATION -> WindowKind.APPLICATION
                AccessibilityWindowInfo.TYPE_INPUT_METHOD -> WindowKind.INPUT_METHOD
                AccessibilityWindowInfo.TYPE_SYSTEM -> WindowKind.SYSTEM
                AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY -> WindowKind.ACCESSIBILITY_OVERLAY
                AccessibilityWindowInfo.TYPE_SPLIT_SCREEN_DIVIDER -> WindowKind.SPLIT_SCREEN_DIVIDER
                TYPE_MAGNIFICATION_OVERLAY -> WindowKind.MAGNIFICATION_OVERLAY
                else -> WindowKind.UNKNOWN
            }
        override val title: String? get() = w.title?.toString()
        override val boundsPx: IntRect
            get() = Rect().let {
                w.getBoundsInScreen(it)
                IntRect(it.left, it.top, it.right, it.bottom)
            }
        override val displayId: Int get() = displayIdOf(w)
        override val focused: Boolean get() = w.isFocused
        override val root: A11yNode? get() = w.root?.let { AndroidNode(it) }
    }

    /** Reads an `AccessibilityNodeInfo` lazily; each getter is a local field read (no IPC) except child(). */
    private class AndroidNode(private val n: AccessibilityNodeInfo) : A11yNode {
        override val className: String? get() = n.className?.toString()
        override val packageName: String? get() = n.packageName?.toString()
        override val text: String? get() = n.text?.toString()
        override val contentDescription: String? get() = n.contentDescription?.toString()
        override val hintText: String? get() = n.hintText?.toString()
        override val tooltipText: String? get() = n.tooltipText?.toString()
        override val showingHintText: Boolean get() = n.isShowingHintText
        override val viewId: String? get() = n.viewIdResourceName
        override val labeledByText: String? get() = n.labeledBy?.text?.toString()
        override val boundsPx: IntRect
            get() = Rect().let {
                n.getBoundsInScreen(it)
                IntRect(it.left, it.top, it.right, it.bottom)
            }
        override val visibleToUser: Boolean get() = n.isVisibleToUser
        override val enabled: Boolean get() = n.isEnabled
        override val focused: Boolean get() = n.isFocused
        override val selected: Boolean get() = n.isSelected
        override val checkable: Boolean get() = n.isCheckable
        override val checked: Boolean get() = n.isChecked
        override val scrollable: Boolean get() = n.isScrollable
        override val password: Boolean get() = n.isPassword
        override val editable: Boolean get() = n.isEditable
        override val clickable: Boolean get() = n.isClickable
        override val longClickable: Boolean get() = n.isLongClickable
        override val focusable: Boolean get() = n.isFocusable
        override val heading: Boolean get() = n.isHeading
        override val drawingOrder: Int get() = n.drawingOrder
        override val actions: List<String> get() = n.actionList.map { actionName(it) }
        override val roleDescription: String?
            get() = n.extras?.getCharSequence(ROLE_DESCRIPTION_KEY)?.toString()
        override val collectionInfo: CollectionInfo?
            get() = n.collectionInfo?.let { CollectionInfo(it.rowCount, it.columnCount) }
        override val collectionItemInfo: CollectionItemInfo?
            get() = n.collectionItemInfo?.let {
                @Suppress("DEPRECATION") // isHeading is deprecated in API 33 but is what 29..32 offer.
                CollectionItemInfo(it.rowIndex, it.columnIndex, it.rowSpan, it.columnSpan, it.isHeading)
            }
        override val rangeInfo: RangeInfo?
            get() = n.rangeInfo?.let { RangeInfo(it.current, it.min, it.max) }
        override val childCount: Int get() = n.childCount

        override fun child(index: Int): A11yNode? = n.getChild(index)?.let { AndroidNode(it) }
    }

    companion object {
        fun displayIdOf(w: AccessibilityWindowInfo): Int =
            if (Build.VERSION.SDK_INT >= 30) w.displayId else Display.DEFAULT_DISPLAY

        /** AccessibilityWindowInfo.TYPE_MAGNIFICATION_OVERLAY (API 33); the constant is newer than minSdk. */
        private const val TYPE_MAGNIFICATION_OVERLAY = 6

        /** Key AndroidX `AccessibilityNodeInfoCompat.setRoleDescription` writes into extras (Compose uses it). */
        private const val ROLE_DESCRIPTION_KEY = "AccessibilityNodeInfo.roleDescription"

        private val ACTION_NAMES: Map<Int, String> = mapOf(
            AccessibilityNodeInfo.ACTION_FOCUS to "focus",
            AccessibilityNodeInfo.ACTION_CLEAR_FOCUS to "clearFocus",
            AccessibilityNodeInfo.ACTION_SELECT to "select",
            AccessibilityNodeInfo.ACTION_CLEAR_SELECTION to "clearSelection",
            AccessibilityNodeInfo.ACTION_CLICK to "click",
            AccessibilityNodeInfo.ACTION_LONG_CLICK to "longClick",
            AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS to "accessibilityFocus",
            AccessibilityNodeInfo.ACTION_CLEAR_ACCESSIBILITY_FOCUS to "clearAccessibilityFocus",
            AccessibilityNodeInfo.ACTION_NEXT_AT_MOVEMENT_GRANULARITY to "nextAtMovementGranularity",
            AccessibilityNodeInfo.ACTION_PREVIOUS_AT_MOVEMENT_GRANULARITY to "previousAtMovementGranularity",
            AccessibilityNodeInfo.ACTION_NEXT_HTML_ELEMENT to "nextHtmlElement",
            AccessibilityNodeInfo.ACTION_PREVIOUS_HTML_ELEMENT to "previousHtmlElement",
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD to "scrollForward",
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD to "scrollBackward",
            AccessibilityNodeInfo.ACTION_COPY to "copy",
            AccessibilityNodeInfo.ACTION_PASTE to "paste",
            AccessibilityNodeInfo.ACTION_CUT to "cut",
            AccessibilityNodeInfo.ACTION_SET_SELECTION to "setSelection",
            AccessibilityNodeInfo.ACTION_EXPAND to "expand",
            AccessibilityNodeInfo.ACTION_COLLAPSE to "collapse",
            AccessibilityNodeInfo.ACTION_DISMISS to "dismiss",
            AccessibilityNodeInfo.ACTION_SET_TEXT to "setText",
            android.R.id.accessibilityActionShowOnScreen to "showOnScreen",
            android.R.id.accessibilityActionScrollToPosition to "scrollToPosition",
            android.R.id.accessibilityActionScrollUp to "scrollUp",
            android.R.id.accessibilityActionScrollDown to "scrollDown",
            android.R.id.accessibilityActionScrollLeft to "scrollLeft",
            android.R.id.accessibilityActionScrollRight to "scrollRight",
            android.R.id.accessibilityActionContextClick to "contextClick",
            android.R.id.accessibilityActionSetProgress to "setProgress",
            android.R.id.accessibilityActionMoveWindow to "moveWindow",
            android.R.id.accessibilityActionShowTooltip to "showTooltip",
            android.R.id.accessibilityActionHideTooltip to "hideTooltip",
        )

        /** Standard actions by name; app-defined actions as `custom:<id>` (labels are localised). */
        fun actionName(a: AccessibilityNodeInfo.AccessibilityAction): String = ACTION_NAMES[a.id] ?: "custom:${a.id}"
    }
}
