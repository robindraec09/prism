package io.prismtest.agent

/**
 * Minimal JSON reader and writer for the agent protocol.
 *
 * Written in-house (instead of org.json or android.util.JsonWriter) so that the whole protocol
 * layer is plain Kotlin and runs in JVM unit tests, and so that `null` values are always written
 * explicitly (the protocol requires every node field to be present).
 *
 * Value model: `Map<String, Any?>` (insertion ordered), `List<Any?>`, `String`, `Long`, `Double`,
 * `Boolean`, `null`. The writer also accepts `Int`, `Float` and `IntArray`.
 */
object Json {
    private const val MAX_DEPTH = 64

    class ParseException(message: String) : Exception(message)

    fun parse(text: String): Any? {
        val p = Parser(text)
        p.skipWs()
        val v = p.value(0)
        p.skipWs()
        if (!p.atEnd()) throw ParseException("Unexpected trailing data at offset ${p.pos}")
        return v
    }

    fun write(value: Any?): String = StringBuilder(256).also { writeTo(it, value) }.toString()

    fun writeTo(sb: StringBuilder, value: Any?) {
        when (value) {
            null -> sb.append("null")
            is String -> writeString(sb, value)
            is Boolean -> sb.append(if (value) "true" else "false")
            is Int, is Long, is Short, is Byte -> sb.append(value.toString())
            is Double -> writeDouble(sb, value)
            is Float -> writeDouble(sb, value.toDouble())
            is Number -> writeDouble(sb, value.toDouble())
            is Map<*, *> -> {
                sb.append('{')
                var first = true
                for ((k, v) in value) {
                    if (!first) sb.append(',')
                    first = false
                    writeString(sb, k.toString())
                    sb.append(':')
                    writeTo(sb, v)
                }
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var first = true
                for (v in value) {
                    if (!first) sb.append(',')
                    first = false
                    writeTo(sb, v)
                }
                sb.append(']')
            }
            is IntArray -> writeTo(sb, value.asList())
            is Array<*> -> writeTo(sb, value.asList())
            else -> writeString(sb, value.toString())
        }
    }

    private fun writeDouble(sb: StringBuilder, d: Double) {
        when {
            d.isNaN() || d.isInfinite() -> sb.append("null")
            d == Math.rint(d) && Math.abs(d) < 1e15 -> sb.append(d.toLong())
            else -> sb.append(d.toString())
        }
    }

    private fun writeString(sb: StringBuilder, s: String) {
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                ' ' -> sb.append("\\u2028")
                ' ' -> sb.append("\\u2029")
                else -> if (c < ' ') {
                    sb.append("\\u00")
                    sb.append(HEX[c.code shr 4])
                    sb.append(HEX[c.code and 0xF])
                } else {
                    sb.append(c)
                }
            }
        }
        sb.append('"')
    }

    private val HEX = "0123456789abcdef".toCharArray()

    private class Parser(val s: String) {
        var pos = 0

        fun atEnd() = pos >= s.length

        fun skipWs() {
            while (pos < s.length) {
                val c = s[pos]
                if (c == ' ' || c == '\n' || c == '\r' || c == '\t') pos++ else break
            }
        }

        fun fail(msg: String): Nothing = throw ParseException("$msg at offset $pos")

        fun value(depth: Int): Any? {
            if (depth > MAX_DEPTH) fail("Nesting too deep")
            if (atEnd()) fail("Unexpected end of input")
            return when (val c = s[pos]) {
                '{' -> obj(depth)
                '[' -> arr(depth)
                '"' -> str()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c in '0'..'9') num() else fail("Unexpected character '$c'")
            }
        }

        fun literal(word: String, v: Any?): Any? {
            if (!s.startsWith(word, pos)) fail("Invalid literal")
            pos += word.length
            return v
        }

        fun obj(depth: Int): Map<String, Any?> {
            pos++ // {
            val m = LinkedHashMap<String, Any?>()
            skipWs()
            if (!atEnd() && s[pos] == '}') {
                pos++
                return m
            }
            while (true) {
                skipWs()
                if (atEnd() || s[pos] != '"') fail("Expected string key")
                val k = str()
                skipWs()
                if (atEnd() || s[pos] != ':') fail("Expected ':'")
                pos++
                skipWs()
                m[k] = value(depth + 1)
                skipWs()
                if (atEnd()) fail("Unterminated object")
                when (s[pos]) {
                    ',' -> pos++
                    '}' -> {
                        pos++
                        return m
                    }
                    else -> fail("Expected ',' or '}'")
                }
            }
        }

        fun arr(depth: Int): List<Any?> {
            pos++ // [
            val l = ArrayList<Any?>()
            skipWs()
            if (!atEnd() && s[pos] == ']') {
                pos++
                return l
            }
            while (true) {
                skipWs()
                l.add(value(depth + 1))
                skipWs()
                if (atEnd()) fail("Unterminated array")
                when (s[pos]) {
                    ',' -> pos++
                    ']' -> {
                        pos++
                        return l
                    }
                    else -> fail("Expected ',' or ']'")
                }
            }
        }

        fun str(): String {
            pos++ // opening quote
            val sb = StringBuilder()
            while (true) {
                if (atEnd()) fail("Unterminated string")
                val c = s[pos++]
                when {
                    c == '"' -> return sb.toString()
                    c == '\\' -> {
                        if (atEnd()) fail("Unterminated escape")
                        when (val e = s[pos++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000C')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (pos + 4 > s.length) fail("Bad unicode escape")
                                val code = s.substring(pos, pos + 4).toIntOrNull(16) ?: fail("Bad unicode escape")
                                sb.append(code.toChar())
                                pos += 4
                            }
                            else -> fail("Bad escape '\\$e'")
                        }
                    }
                    c < ' ' -> fail("Control character in string")
                    else -> sb.append(c)
                }
            }
        }

        fun num(): Any {
            val start = pos
            if (s[pos] == '-') pos++
            var isInt = true
            while (pos < s.length) {
                val c = s[pos]
                if (c in '0'..'9') {
                    pos++
                } else if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
                    isInt = false
                    pos++
                } else {
                    break
                }
            }
            val t = s.substring(start, pos)
            if (t == "-" || t.isEmpty()) fail("Invalid number")
            if (isInt) t.toLongOrNull()?.let { return it }
            return t.toDoubleOrNull() ?: fail("Invalid number '$t'")
        }
    }
}
