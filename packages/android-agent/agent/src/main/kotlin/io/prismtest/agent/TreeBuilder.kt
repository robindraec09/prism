package io.prismtest.agent

data class TreeOptions(
    /** Depth limit counted from the synthetic `screen` root (depth 0). Null means unlimited. */
    val maxDepth: Int? = null,
    val maxNodes: Int = 5000,
    val visibleOnly: Boolean = false,
    val includeRaw: Boolean = true,
    /** `webContent: "include"`; default `prune` (protocol.md 2.8 rule 4). */
    val includeWebContent: Boolean = false,
)

/**
 * Maps windows and accessibility nodes to the normalised tree (protocol.md 2.1-2.9).
 *
 * Node IDs are `n<k>` in pre-order and only meaningful with the snapshot ID the caller assigns.
 * One builder is used for one snapshot.
 */
class TreeBuilder(private val opts: TreeOptions, private val screen: ScreenInfo) {
    private var nextId = 0
    var nodeCount = 0
        private set
    var truncated = false
        private set

    private val density = screen.density.toDouble()
    private val screenRect = IntRect(0, 0, screen.widthPx, screen.heightPx)

    fun build(windows: List<A11yWindow>): Map<String, Any?> {
        val root = synthetic("screen", "prism.Screen", null, screenRect, focused = false)
        nodeCount = 1
        val children = ArrayList<Any?>()
        if (opts.maxDepth != null && opts.maxDepth < 1) {
            if (windows.isNotEmpty()) truncated = true
        } else {
            var lowerAppWindow = false
            for (w in windows) {
                if (nodeCount >= opts.maxNodes) {
                    truncated = true
                    break
                }
                children.add(windowNode(w, lowerAppWindow))
                if (w.kind == WindowKind.APPLICATION) lowerAppWindow = true
            }
        }
        root["children"] = children
        return root
    }

    private fun windowNode(w: A11yWindow, lowerAppWindow: Boolean): Map<String, Any?> {
        val rootView = w.root
        val pkg = rootView?.packageName
        val (role, type) = classifyWindow(w, pkg, lowerAppWindow)
        val node = synthetic(role, "prism.Window", w.title?.takeIf { it.isNotEmpty() }, w.boundsPx, w.focused)
        nodeCount++
        if (opts.includeRaw) {
            node["raw"] = linkedMapOf<String, Any?>(
                "package" to pkg,
                "windowId" to w.id,
                "windowType" to type,
                "displayId" to w.displayId,
                "layer" to w.layer,
            )
        }
        val children = ArrayList<Any?>(1)
        if (rootView != null) {
            if (opts.maxDepth != null && opts.maxDepth < 2) {
                truncated = true
            } else {
                mapNode(rootView, 2, null, false)?.let { children.add(it) }
            }
        }
        node["children"] = children
        return node
    }

    /** Role and `raw.windowType` for a window (protocol.md 2.7). */
    private fun classifyWindow(w: A11yWindow, pkg: String?, lowerAppWindow: Boolean): Pair<String, String> = when (w.kind) {
        WindowKind.INPUT_METHOD -> "keyboard" to "inputMethod"
        WindowKind.APPLICATION -> when {
            pkg != null && pkg in SYSTEM_UI_PACKAGES -> "window" to "system"
            lowerAppWindow && !w.boundsPx.contains(screenRect) -> "dialog" to "application"
            else -> "window" to "application"
        }
        WindowKind.ACCESSIBILITY_OVERLAY -> "window" to "accessibilityOverlay"
        else -> "window" to "system"
    }

    private fun synthetic(role: String, nativeType: String, name: String?, px: IntRect, focused: Boolean): LinkedHashMap<String, Any?> {
        val visible = !px.isEmpty
        return linkedMapOf(
            "id" to "n${nextId++}",
            "role" to role,
            "name" to name,
            "text" to null,
            "value" to null,
            "testId" to null,
            "nativeType" to nativeType,
            "bounds" to dipRect(px),
            "visible" to visible,
            "onScreen" to (visible && px.intersects(screenRect)),
            "enabled" to true,
            "focused" to focused,
            "selected" to false,
            "checked" to null,
            "scrollable" to false,
            "password" to false,
            "webContent" to false,
            "context" to "native",
        )
    }

    private fun mapNode(n: A11yNode, depth: Int, parentRole: String?, parentInWeb: Boolean): Map<String, Any?>? {
        if (opts.visibleOnly && !n.visibleToUser) return null
        if (nodeCount >= opts.maxNodes) {
            truncated = true
            return null
        }
        nodeCount++
        val role = RoleMapper.roleOf(n, parentRole)
        val inWeb = parentInWeb || parentRole == "webview"
        val password = n.password
        val editable = n.editable

        val desc = clean(n.contentDescription)
        val labeled = clean(n.labeledByText)
        val hintText = clean(n.hintText)
        val rawText = n.text
        val text = if (editable || password || rawText == null) null else TextNormalizer.normalize(rawText).ifEmpty { null }
        val name = if (editable) {
            hintText ?: labeled ?: desc
        } else {
            desc ?: labeled ?: (if (password) null else text)
        }
        val value: String? = when {
            password -> null // protocol.md 2.2, 11.5: never send password values
            editable -> if (n.showingHintText) "" else (rawText ?: "")
            n.rangeInfo != null -> formatNumber(n.rangeInfo!!.current)
            else -> null
        }
        val hint = hintText ?: clean(n.tooltipText)
        val testId = n.viewId?.takeIf { it.isNotEmpty() }
        val px = n.boundsPx
        val visible = n.visibleToUser

        val m = LinkedHashMap<String, Any?>(32)
        m["id"] = "n${nextId++}"
        m["role"] = role
        m["name"] = name
        m["text"] = text
        m["value"] = value
        if (hint != null) m["hint"] = hint
        m["testId"] = testId
        m["nativeType"] = n.className ?: "android.view.View"
        m["bounds"] = dipRect(px)
        m["visible"] = visible
        m["onScreen"] = visible && px.intersects(screenRect)
        m["enabled"] = n.enabled
        m["focused"] = n.focused
        m["selected"] = n.selected
        m["checked"] = if (n.checkable) n.checked else null
        val actions = n.actions
        when {
            "collapse" in actions -> m["expanded"] = true
            "expand" in actions -> m["expanded"] = false
        }
        m["scrollable"] = n.scrollable
        m["password"] = password
        m["webContent"] = inWeb
        m["context"] = "native"

        val raw = if (opts.includeRaw) rawOf(n, testId, actions, px) else null
        if (raw != null) m["raw"] = raw

        val children = ArrayList<Any?>()
        val count = n.childCount
        if (count > 0) {
            when {
                role == "webview" && !opts.includeWebContent -> raw?.put("webContentPruned", true)
                opts.maxDepth != null && depth + 1 > opts.maxDepth -> truncated = true
                else -> {
                    val kids = ArrayList<A11yNode>(count)
                    for (i in 0 until count) n.child(i)?.let { kids.add(it) }
                    // Back to front (protocol.md 2.2); stable, so equal orders keep reading order.
                    kids.sortBy { it.drawingOrder }
                    for (k in kids) {
                        if (nodeCount >= opts.maxNodes) {
                            truncated = true
                            break
                        }
                        mapNode(k, depth + 1, role, inWeb)?.let { children.add(it) }
                    }
                }
            }
        }
        m["children"] = children
        return m
    }

    private fun rawOf(n: A11yNode, testId: String?, actions: List<String>, px: IntRect): LinkedHashMap<String, Any?> {
        // Never add `text` or any other key that can carry a password value (protocol.md 2.9).
        val r = LinkedHashMap<String, Any?>()
        n.className?.let { r["className"] = it }
        if (testId != null) r["resourceId"] = testId
        n.packageName?.let { r["package"] = it }
        if (n.clickable) r["clickable"] = true
        if (n.longClickable) r["longClickable"] = true
        if (n.focusable) r["focusable"] = true
        if (n.checkable) r["checkable"] = true
        if (n.editable) r["editable"] = true
        r["drawingOrder"] = n.drawingOrder
        if (actions.isNotEmpty()) r["actions"] = actions
        r["boundsPx"] = listOf(px.left, px.top, px.right, px.bottom)
        clean(n.roleDescription)?.let { r["roleDescription"] = it }
        n.collectionInfo?.let { r["collectionInfo"] = linkedMapOf("rowCount" to it.rowCount, "columnCount" to it.columnCount) }
        n.collectionItemInfo?.let {
            r["collectionItemInfo"] = linkedMapOf(
                "rowIndex" to it.rowIndex, "columnIndex" to it.columnIndex,
                "rowSpan" to it.rowSpan, "columnSpan" to it.columnSpan, "heading" to it.heading,
            )
        }
        return r
    }

    private fun dipRect(px: IntRect): Map<String, Any?> = linkedMapOf(
        "x" to round2(px.left / density),
        "y" to round2(px.top / density),
        "width" to round2(px.width.coerceAtLeast(0) / density),
        "height" to round2(px.height.coerceAtLeast(0) / density),
    )

    private fun clean(s: String?): String? = s?.takeIf { it.isNotBlank() }

    private fun formatNumber(f: Float): String =
        if (f == Math.rint(f.toDouble()).toFloat() && Math.abs(f) < 1e9f) f.toLong().toString() else f.toString()

    companion object {
        /** Application-type windows that belong to the system (permission prompts, system UI). */
        val SYSTEM_UI_PACKAGES = setOf(
            "com.android.systemui",
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
        )
    }
}
