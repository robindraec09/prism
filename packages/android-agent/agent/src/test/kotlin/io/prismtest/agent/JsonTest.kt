package io.prismtest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class JsonTest {
    @Test
    fun writesNullsExplicitlyAndKeepsOrder() {
        val s = Json.write(linkedMapOf("b" to null, "a" to listOf(1, 2.5, true, "x")))
        assertEquals("""{"b":null,"a":[1,2.5,true,"x"]}""", s)
    }

    @Test
    fun writesWholeDoublesAsIntegersAndNonFiniteAsNull() {
        assertEquals("[360,1.5,null]", Json.write(listOf(360.0, 1.5, Double.NaN)))
    }

    @Test
    fun escapesStrings() {
        assertEquals("\"a\\\"b\\\\c\\n\\u0001\\u2028\"", Json.write("a\"b\\c\n\u0001 "))
    }

    @Test
    fun roundTrips() {
        val text = """{"v":"1.0","id":"r-1","params":{"x":12.5,"n":-3,"ok":false,"z":null,"s":"é\n","l":[]}}"""
        val parsed = Json.parse(text).obj()
        assertEquals("1.0", parsed["v"])
        val params = parsed["params"].obj()
        assertEquals(12.5, params["x"])
        assertEquals(-3L, params["n"])
        assertEquals(false, params["ok"])
        assertEquals(null, params["z"])
        assertEquals("é\n", params["s"])
        assertEquals(emptyList<Any?>(), params["l"])
        assertEquals(parsed, Json.parse(Json.write(parsed)))
    }

    @Test
    fun rejectsMalformedInput() {
        for (bad in listOf("", "{", "{\"a\":}", "[1,]", "{\"a\":1} x", "tru", "\"\u0001\"", "-")) {
            assertThrows(Json.ParseException::class.java) { Json.parse(bad) }
        }
    }

    @Test
    fun rejectsDeepNesting() {
        assertThrows(Json.ParseException::class.java) { Json.parse("[".repeat(100) + "]".repeat(100)) }
    }
}
