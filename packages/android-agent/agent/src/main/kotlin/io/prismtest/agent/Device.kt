package io.prismtest.agent

/**
 * The platform boundary. Everything above it (HTTP, protocol, tree mapping) is plain Kotlin and
 * unit-tested on the JVM with fakes; [UiAutomationDevice] implements it on Android.
 */
interface DeviceBackend {
    fun deviceInfo(): DeviceInfo

    fun screen(): ScreenInfo

    /** Windows of the default display, back to front (ascending layer). */
    fun windows(): List<A11yWindow>

    /** `SystemClock.uptimeMillis()` of the last window/content change event, or 0. */
    fun lastContentChangeMs(): Long

    fun uptimeMs(): Long

    /** Waits until no accessibility events arrive for [quietMs], up to [maxWaitMs]. True if idle. */
    fun waitForIdle(quietMs: Long, maxWaitMs: Long): Boolean

    /** Injects a tap at device-pixel coordinates and returns after touch-up. */
    fun tap(xPx: Float, yPx: Float, downMs: Long)
}

data class IntRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width get() = right - left
    val height get() = bottom - top
    val isEmpty get() = width <= 0 || height <= 0

    fun intersects(o: IntRect) = left < o.right && o.left < right && top < o.bottom && o.top < bottom

    fun contains(o: IntRect) = left <= o.left && top <= o.top && right >= o.right && bottom >= o.bottom
}

data class ScreenInfo(
    val widthPx: Int,
    val heightPx: Int,
    /** Device pixels per DIP (`DisplayMetrics.density`). */
    val density: Float,
    /** Interface rotation in degrees: 0, 90, 180 or 270. */
    val rotation: Int,
) {
    val widthDip get() = widthPx / density.toDouble()
    val heightDip get() = heightPx / density.toDouble()

    fun toJson(): Map<String, Any?> = linkedMapOf(
        "width" to round2(widthDip),
        "height" to round2(heightDip),
        "scale" to round2(density.toDouble()),
        "rotation" to rotation,
        "orientation" to if (widthPx > heightPx) "landscape" else "portrait",
    )
}

data class DeviceInfo(
    val osVersion: String,
    val apiLevel: Int,
    val model: String,
    val emulator: Boolean,
    val locale: String,
    val timeZone: String,
)

enum class WindowKind { APPLICATION, INPUT_METHOD, SYSTEM, ACCESSIBILITY_OVERLAY, SPLIT_SCREEN_DIVIDER, MAGNIFICATION_OVERLAY, UNKNOWN }

interface A11yWindow {
    val id: Int
    val layer: Int
    val kind: WindowKind
    val title: String?
    val boundsPx: IntRect
    val displayId: Int
    val focused: Boolean
    val root: A11yNode?
}

data class CollectionInfo(val rowCount: Int, val columnCount: Int)

data class CollectionItemInfo(val rowIndex: Int, val columnIndex: Int, val rowSpan: Int, val columnSpan: Int, val heading: Boolean)

data class RangeInfo(val current: Float, val min: Float, val max: Float)

/** The subset of `AccessibilityNodeInfo` the tree mapper reads. */
interface A11yNode {
    val className: String?
    val packageName: String?
    val text: String?
    val contentDescription: String?
    val hintText: String?
    val tooltipText: String?
    val showingHintText: Boolean
    val viewId: String?
    val labeledByText: String?
    val boundsPx: IntRect
    val visibleToUser: Boolean
    val enabled: Boolean
    val focused: Boolean
    val selected: Boolean
    val checkable: Boolean
    val checked: Boolean
    val scrollable: Boolean
    val password: Boolean
    val editable: Boolean
    val clickable: Boolean
    val longClickable: Boolean
    val focusable: Boolean
    val heading: Boolean
    val drawingOrder: Int
    val actions: List<String>
    val roleDescription: String?
    val collectionInfo: CollectionInfo?
    val collectionItemInfo: CollectionItemInfo?
    val rangeInfo: RangeInfo?
    val childCount: Int

    fun child(index: Int): A11yNode?
}

internal fun round2(d: Double): Double = Math.round(d * 100.0) / 100.0
