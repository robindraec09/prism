package io.prismtest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TreeBuilderTest {
    private val screen = ScreenInfo(1080, 2400, 3f, 0)

    private fun build(windows: List<A11yWindow>, opts: TreeOptions = TreeOptions()): Pair<TreeBuilder, Map<String, Any?>> {
        val b = TreeBuilder(opts, screen)
        return b to b.build(windows)
    }

    @Test
    fun mapsTheProtocolExample() {
        val (b, root) = build(loginScreen().windowList)
        val nodes = flatten(root)
        assertEquals(listOf("n0", "n1", "n2", "n3", "n4", "n5"), nodes.map { it["id"] })
        assertEquals(6, b.nodeCount)
        assertFalse(b.truncated)
        assertEquals(listOf("screen", "window", "generic", "textbox", "textbox", "button"), nodes.map { it["role"] })
        assertEquals(mapOf("x" to 0.0, "y" to 0.0, "width" to 360.0, "height" to 800.0), root["bounds"])

        val window = nodes[1]
        assertEquals("Shop", window["name"])
        assertEquals("prism.Window", window["nativeType"])
        assertEquals("application", window["raw"].obj()["windowType"])
        assertEquals(12, window["raw"].obj()["windowId"])

        val email = nodes[3]
        assertEquals("Email", email["name"])
        assertEquals("ada@example.com", email["value"])
        assertNull(email["text"])
        assertEquals("com.example.shop:id/email", email["testId"])
        assertEquals(mapOf("x" to 16.0, "y" to 300.0, "width" to 328.0, "height" to 56.0), email["bounds"])

        val signIn = nodes[5]
        assertEquals("Sign in", signIn["name"])
        assertEquals("Sign in", signIn["text"])
        assertEquals(listOf(48, 1500, 1032, 1644), signIn["raw"].obj()["boundsPx"])
    }

    @Test
    fun neverSendsPasswordValues() {
        val (_, root) = build(loginScreen().windowList)
        val pw = flatten(root).first { it["password"] == true }
        assertNull(pw["value"])
        assertNull(pw["text"])
        assertEquals("Password", pw["name"])
        assertFalse(pw["raw"].obj().containsKey("text"))
        assertFalse(Json.write(root).contains("hunter2"))
    }

    @Test
    fun nodesAlwaysCarryRequiredFields() {
        val required = listOf(
            "id", "role", "name", "text", "value", "testId", "nativeType", "bounds", "visible", "onScreen",
            "enabled", "focused", "selected", "checked", "scrollable", "password", "webContent", "context", "children",
        )
        val (_, root) = build(loginScreen().windowList)
        for (n in flatten(root)) for (k in required) assertTrue("$k missing on ${n["id"]}", n.containsKey(k))
    }

    @Test
    fun rolesUseCollectionsBeforeClassesAndContextRules() {
        val row = FakeNode(className = "android.widget.LinearLayout", collectionItemInfo = CollectionItemInfo(0, 0, 1, 1, false))
        val plain = FakeNode(className = "android.widget.LinearLayout")
        val list = FakeNode(className = "androidx.recyclerview.widget.RecyclerView", collectionInfo = CollectionInfo(10, 1), children = listOf(row, plain))
        val tab = FakeNode(className = "android.widget.Button")
        val tabs = FakeNode(className = "com.google.android.material.tabs.TabLayout", children = listOf(tab))
        val composeSwitch = FakeNode(className = "android.view.View", checkable = true, checked = true)
        val heading = FakeNode(className = "android.widget.TextView", text = "Title", heading = true)
        val search = FakeNode(className = "android.widget.SearchView\$SearchAutoComplete", editable = true)
        val checked = FakeNode(className = "android.widget.CheckedTextView", checkable = true)
        val root = FakeNode(children = listOf(list, tabs, composeSwitch, heading, search, checked))
        val nodes = flatten(build(listOf(FakeWindow(root = root))).second)
        val roles = nodes.drop(2).map { it["role"] }
        assertEquals(listOf("generic", "list", "listitem", "listitem", "tablist", "tab", "switch", "heading", "searchbox", "checkbox"), roles)
        assertEquals(true, nodes.first { it["role"] == "switch" }["checked"])
        assertNull(nodes.first { it["role"] == "heading" }["checked"])
    }

    @Test
    fun prunesWebContentByDefaultAndFlagsItWhenIncluded() {
        val webButton = FakeNode(className = "android.widget.Button", text = "Pay")
        val webview = FakeNode(className = "android.webkit.WebView", children = listOf(FakeNode(children = listOf(webButton))))
        val windows = listOf(FakeWindow(root = FakeNode(children = listOf(webview))))

        val pruned = flatten(build(windows).second)
        val wv = pruned.first { it["role"] == "webview" }
        assertEquals(emptyList<Any?>(), wv["children"])
        assertEquals(true, wv["raw"].obj()["webContentPruned"])
        assertFalse(wv["webContent"] as Boolean)

        val included = flatten(build(windows, TreeOptions(includeWebContent = true)).second)
        val pay = included.first { it["text"] == "Pay" }
        assertEquals(true, pay["webContent"])
        assertEquals(true, included.first { it["role"] == "generic" && it["webContent"] == true }["webContent"])
    }

    @Test
    fun classifiesWindows() {
        val app = FakeWindow(id = 1, layer = 1, root = FakeNode())
        val dialog = FakeWindow(id = 2, layer = 2, boundsPx = IntRect(100, 800, 980, 1600), root = FakeNode())
        val ime = FakeWindow(id = 3, layer = 3, kind = WindowKind.INPUT_METHOD, boundsPx = IntRect(0, 1500, 1080, 2400), root = FakeNode())
        val perm = FakeWindow(id = 4, layer = 4, boundsPx = IntRect(0, 1200, 1080, 2400), root = FakeNode(packageName = "com.google.android.permissioncontroller"))
        val bar = FakeWindow(id = 5, layer = 5, kind = WindowKind.SYSTEM, boundsPx = IntRect(0, 0, 1080, 72), root = FakeNode(packageName = "com.android.systemui"))
        val windows = build(listOf(app, dialog, ime, perm, bar)).second.kids()
        assertEquals(listOf("window", "dialog", "keyboard", "window", "window"), windows.map { it["role"] })
        assertEquals(
            listOf("application", "application", "inputMethod", "system", "system"),
            windows.map { it["raw"].obj()["windowType"] },
        )
    }

    @Test
    fun honoursMaxNodesMaxDepthAndVisibleOnly() {
        val leaves = (1..10).map { FakeNode(className = "android.widget.TextView", text = "t$it", visibleToUser = it % 2 == 0) }
        val windows = listOf(FakeWindow(root = FakeNode(children = leaves)))

        val (b1, r1) = build(windows, TreeOptions(maxNodes = 5))
        assertEquals(5, b1.nodeCount)
        assertEquals(5, flatten(r1).size)
        assertTrue(b1.truncated)

        val (b2, r2) = build(windows, TreeOptions(maxDepth = 2))
        assertEquals(3, flatten(r2).size)
        assertTrue(b2.truncated)

        val (b3, r3) = build(windows, TreeOptions(visibleOnly = true))
        assertEquals(3 + 5, flatten(r3).size)
        assertFalse(b3.truncated)
    }

    @Test
    fun sortsChildrenByDrawingOrderStably() {
        val a = FakeNode(text = "a", className = "android.widget.TextView", drawingOrder = 2)
        val b = FakeNode(text = "b", className = "android.widget.TextView", drawingOrder = 1)
        val c = FakeNode(text = "c", className = "android.widget.TextView", drawingOrder = 1)
        val nodes = flatten(build(listOf(FakeWindow(root = FakeNode(children = listOf(a, b, c))))).second)
        assertEquals(listOf("b", "c", "a"), nodes.mapNotNull { it["text"] })
    }

    @Test
    fun normalisesTextAndEditableHints() {
        val label = FakeNode(className = "android.widget.TextView", text = "  Sign\u00A0\u200Bin \n now ")
        val empty = FakeNode(className = "android.widget.EditText", editable = true, text = "Search", hintText = "Search", showingHintText = true)
        val nodes = flatten(build(listOf(FakeWindow(root = FakeNode(children = listOf(label, empty))))).second)
        assertEquals("Sign in now", nodes[3]["text"])
        assertEquals("", nodes[4]["value"])
        assertEquals("Search", nodes[4]["name"])
    }

    @Test
    fun textNormalizer() {
        assertEquals("a b", TextNormalizer.normalize("\u2007a\u202F\u3000 b\uFEFF"))
        assertEquals("\u00e9", TextNormalizer.normalize("e\u0301"))
    }
}
