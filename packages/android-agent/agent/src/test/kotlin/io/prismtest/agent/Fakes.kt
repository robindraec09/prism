package io.prismtest.agent

data class FakeNode(
    override val className: String? = "android.view.View",
    override val packageName: String? = "com.example.shop",
    override val text: String? = null,
    override val contentDescription: String? = null,
    override val hintText: String? = null,
    override val tooltipText: String? = null,
    override val showingHintText: Boolean = false,
    override val viewId: String? = null,
    override val labeledByText: String? = null,
    override val boundsPx: IntRect = IntRect(0, 0, 1080, 2400),
    override val visibleToUser: Boolean = true,
    override val enabled: Boolean = true,
    override val focused: Boolean = false,
    override val selected: Boolean = false,
    override val checkable: Boolean = false,
    override val checked: Boolean = false,
    override val scrollable: Boolean = false,
    override val password: Boolean = false,
    override val editable: Boolean = false,
    override val clickable: Boolean = false,
    override val longClickable: Boolean = false,
    override val focusable: Boolean = false,
    override val heading: Boolean = false,
    override val drawingOrder: Int = 0,
    override val actions: List<String> = emptyList(),
    override val roleDescription: String? = null,
    override val collectionInfo: CollectionInfo? = null,
    override val collectionItemInfo: CollectionItemInfo? = null,
    override val rangeInfo: RangeInfo? = null,
    val children: List<FakeNode> = emptyList(),
) : A11yNode {
    override val childCount: Int get() = children.size

    override fun child(index: Int): A11yNode? = children.getOrNull(index)
}

data class FakeWindow(
    override val id: Int = 1,
    override val layer: Int = 0,
    override val kind: WindowKind = WindowKind.APPLICATION,
    override val title: String? = "Shop",
    override val boundsPx: IntRect = IntRect(0, 0, 1080, 2400),
    override val displayId: Int = 0,
    override val focused: Boolean = true,
    override val root: A11yNode? = null,
) : A11yWindow

class FakeDevice(
    var windowList: List<A11yWindow> = emptyList(),
    val screenInfo: ScreenInfo = ScreenInfo(1080, 2400, 3f, 0),
) : DeviceBackend {
    val taps = mutableListOf<Triple<Float, Float, Long>>()
    var idleResult = true
    var tapDelayMs = 0L
    var changeDuringCapture = false
    private var uptime = 1000L
    private var lastChange = 0L

    override fun deviceInfo() = DeviceInfo("14", 34, "sdk_gphone64_x86_64", true, "en-US", "UTC")

    override fun screen() = screenInfo

    override fun windows(): List<A11yWindow> {
        uptime += 5
        if (changeDuringCapture) lastChange = uptime
        return windowList
    }

    override fun lastContentChangeMs() = lastChange

    override fun uptimeMs() = uptime

    override fun waitForIdle(quietMs: Long, maxWaitMs: Long) = idleResult

    override fun tap(xPx: Float, yPx: Float, downMs: Long) {
        if (tapDelayMs > 0) Thread.sleep(tapDelayMs)
        taps.add(Triple(xPx, yPx, downMs))
    }
}

class SilentLog : AgentLog {
    override fun info(msg: String) {}

    override fun warn(msg: String, t: Throwable?) {}
}

/** Login screen from protocol.md 12.2, at 1080 x 2400 px, density 3. */
fun loginScreen(): FakeDevice {
    val email = FakeNode(
        className = "android.widget.EditText", text = "ada@example.com", hintText = "Email",
        viewId = "com.example.shop:id/email", editable = true, clickable = true, focusable = true,
        boundsPx = IntRect(48, 900, 1032, 1068),
    )
    val password = FakeNode(
        className = "android.widget.EditText", text = "hunter2", hintText = "Password",
        viewId = "com.example.shop:id/password", editable = true, password = true, focused = true,
        boundsPx = IntRect(48, 1116, 1032, 1284),
    )
    val signIn = FakeNode(
        className = "android.widget.Button", text = "Sign in", viewId = "com.example.shop:id/sign_in",
        clickable = true, actions = listOf("click"), boundsPx = IntRect(48, 1500, 1032, 1644),
    )
    val frame = FakeNode(className = "android.widget.FrameLayout", children = listOf(email, password, signIn))
    return FakeDevice(listOf(FakeWindow(id = 12, root = frame)))
}

@Suppress("UNCHECKED_CAST")
fun Any?.obj(): Map<String, Any?> = this as Map<String, Any?>

@Suppress("UNCHECKED_CAST")
fun Any?.list(): List<Any?> = this as List<Any?>

fun Map<String, Any?>.kids(): List<Map<String, Any?>> = this["children"].list().map { it.obj() }

/** All nodes of a normalised tree in pre-order. */
fun flatten(root: Map<String, Any?>): List<Map<String, Any?>> = listOf(root) + root.kids().flatMap { flatten(it) }
