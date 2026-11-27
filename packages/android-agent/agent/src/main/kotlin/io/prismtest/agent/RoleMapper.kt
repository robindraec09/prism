package io.prismtest.agent

import java.text.Normalizer

/** Android role mapping, protocol.md 2.3 (precedence) and 2.4 (Android table). */
object RoleMapper {
    // Keyed by simple class name (after the last '.'), so AndroidX/Material variants match too.
    private val BY_CLASS: Map<String, String> = buildMap {
        listOf(
            "Button", "ImageButton", "MaterialButton", "FloatingActionButton", "ExtendedFloatingActionButton",
            "AppCompatButton", "AppCompatImageButton", "ToggleButton", "AppCompatToggleButton",
        ).forEach { put(it, "button") }
        listOf("TextView", "AppCompatTextView", "MaterialTextView").forEach { put(it, "text") }
        listOf("EditText", "AppCompatEditText", "TextInputEditText").forEach { put(it, "textbox") }
        listOf(
            "AutoCompleteTextView", "AppCompatAutoCompleteTextView", "MaterialAutoCompleteTextView",
            "Spinner", "AppCompatSpinner",
        ).forEach { put(it, "combobox") }
        put("SearchView\$SearchAutoComplete", "searchbox")
        listOf("CheckBox", "AppCompatCheckBox", "MaterialCheckBox").forEach { put(it, "checkbox") }
        listOf("RadioButton", "AppCompatRadioButton", "MaterialRadioButton").forEach { put(it, "radio") }
        put("RadioGroup", "group")
        listOf("Switch", "SwitchCompat", "SwitchMaterial", "MaterialSwitch").forEach { put(it, "switch") }
        listOf("SeekBar", "AppCompatSeekBar", "RatingBar", "AppCompatRatingBar").forEach { put(it, "slider") }
        put("ProgressBar", "progressbar")
        put("NumberPicker", "spinbutton")
        listOf("ImageView", "AppCompatImageView", "ShapeableImageView").forEach { put(it, "image") }
        listOf("TabLayout", "TabWidget").forEach { put(it, "tablist") }
        put("TabLayout\$TabView", "tab")
        listOf("Toolbar", "MaterialToolbar").forEach { put(it, "toolbar") }
        put("WebView", "webview")
    }

    private val CHECKED_TEXT_VIEWS = setOf("CheckedTextView", "AppCompatCheckedTextView", "MaterialCheckedTextView")

    fun simpleName(className: String?): String = className?.substringAfterLast('.') ?: ""

    /**
     * Role of [node] given the already-mapped role of its parent in the normalised tree
     * (`null` for a window's root view).
     */
    fun roleOf(node: A11yNode, parentRole: String?): String {
        val base = baseRole(node, parentRole)
        // Context rules (2.3): applied only where they refine the base role.
        if (base == "generic" && parentRole == "list") return "listitem"
        if (base == "button" && parentRole == "tablist") return "tab"
        return base
    }

    private fun baseRole(node: A11yNode, parentRole: String?): String {
        // 1. Explicit semantics.
        if (node.heading) return "heading"
        node.collectionInfo?.let { return if (it.columnCount > 1 && it.rowCount > 1) "grid" else "list" }
        if (node.collectionItemInfo != null) {
            if (parentRole == "grid") return "cell"
            if (parentRole == "list") return "listitem"
        }
        // 2. Class table.
        val simple = simpleName(node.className)
        if (simple in CHECKED_TEXT_VIEWS) return if (node.checkable) "checkbox" else "text"
        BY_CLASS[simple]?.let { return it }
        // 3. Fallbacks for classes we do not know (custom views, Compose `android.view.View`).
        if (node.editable) return "textbox"
        if (node.checkable && (simple == "View" || simple.isEmpty())) return "switch" // Compose Role.Switch, best effort
        return "generic"
    }

    val ACTIONABLE = setOf(
        "button", "link", "textbox", "searchbox", "checkbox", "radio", "switch", "slider", "spinbutton",
        "combobox", "tab", "menuitem", "option", "listitem", "cell",
    )
}

/** Text normalisation, protocol.md 3.4 steps 1-3. */
object TextNormalizer {
    private fun isWhiteSpace(c: Char): Boolean = when (c) {
        '\u0009', '\u000A', '\u000B', '\u000C', '\u000D', ' ', '\u0085', ' ', ' ',
        ' ', ' ', ' ', ' ', '　',
        -> true
        else -> c in ' '..' '
    }

    fun normalize(s: String): String {
        val nfc = Normalizer.normalize(s, Normalizer.Form.NFC)
        val sb = StringBuilder(nfc.length)
        var pendingSpace = false
        for (c in nfc) {
            if (c == '​' || c == '⁠' || c == '﻿') continue
            if (isWhiteSpace(c)) {
                pendingSpace = sb.isNotEmpty()
                continue
            }
            if (pendingSpace) sb.append(' ')
            pendingSpace = false
            sb.append(c)
        }
        return sb.toString()
    }
}
