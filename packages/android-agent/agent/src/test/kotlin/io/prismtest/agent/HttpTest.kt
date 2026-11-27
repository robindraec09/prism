package io.prismtest.agent

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPInputStream

class HttpTest {
    private fun req(s: String) = HttpCodec.readRequest(ByteArrayInputStream(s.toByteArray(Charsets.ISO_8859_1)))

    @Test
    fun parsesRequestWithBody() {
        val r = req("POST /v1/command?x=1 HTTP/1.1\r\nHost: 127.0.0.1:52817\r\nContent-Length: 2\r\nAuthorization: Bearer t\r\n\r\n{}")!!
        assertEquals("POST", r.method)
        assertEquals("/v1/command", r.path)
        assertEquals("127.0.0.1:52817", r.header("Host"))
        assertArrayEquals("{}".toByteArray(), r.body)
        assertTrue(r.keepAlive)
    }

    @Test
    fun returnsNullOnCleanEof() {
        assertNull(req(""))
    }

    @Test
    fun connectionClose() {
        assertFalse(req("GET /version HTTP/1.1\r\nConnection: close\r\n\r\n")!!.keepAlive)
    }

    @Test
    fun rejectsOversizedAndChunkedBodies() {
        val e = assertThrows(HttpError::class.java) { req("POST / HTTP/1.1\r\nContent-Length: 2000000\r\n\r\n") }
        assertEquals(413, e.status)
        val c = assertThrows(HttpError::class.java) { req("POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n") }
        assertEquals(501, c.status)
        val b = assertThrows(HttpError::class.java) { req("GARBAGE\r\n\r\n") }
        assertEquals(400, b.status)
    }

    @Test
    fun gzipsLargeBodiesOnly() {
        val big = ByteArray(5000) { 'a'.code.toByte() }
        val out = ByteArrayOutputStream()
        HttpCodec.writeResponse(out, 200, big, gzip = true)
        val bytes = out.toByteArray()
        val headerEnd = String(bytes, Charsets.ISO_8859_1).indexOf("\r\n\r\n") + 4
        val head = String(bytes, 0, headerEnd, Charsets.ISO_8859_1)
        assertTrue(head.contains("Content-Encoding: gzip"))
        val body = GZIPInputStream(ByteArrayInputStream(bytes, headerEnd, bytes.size - headerEnd)).readBytes()
        assertArrayEquals(big, body)

        val small = ByteArrayOutputStream()
        HttpCodec.writeResponse(small, 200, "{}".toByteArray(), gzip = true)
        assertFalse(small.toString("ISO-8859-1").contains("Content-Encoding"))
    }

    @Test
    fun hostCheckAcceptsLoopbackNamesOnAnyPort() {
        for (ok in listOf("127.0.0.1", "127.0.0.1:52817", "localhost:7100", "LOCALHOST", "[::1]", "[::1]:1")) {
            assertTrue(ok, Security.hostAllowed(ok))
        }
        for (bad in listOf(
            null, "", "evil.com", "127.0.0.1.evil.com", "localhost.evil.com:80", "::1", "[::1]x", "127.0.0.1:",
            "127.0.0.1:abc", "10.0.2.2:7100", "127.0.0.1:7100, evil.com",
        )) {
            assertFalse(bad.toString(), Security.hostAllowed(bad))
        }
    }

    @Test
    fun tokenCheck() {
        val t = "s3cr3t-token-0123456789abcdefghijklmnop".toByteArray()
        assertTrue(Security.tokenMatches("Bearer s3cr3t-token-0123456789abcdefghijklmnop", t))
        assertTrue(Security.tokenMatches("bearer s3cr3t-token-0123456789abcdefghijklmnop", t))
        assertFalse(Security.tokenMatches(null, t))
        assertFalse(Security.tokenMatches("Bearer wrong", t))
        assertFalse(Security.tokenMatches("Basic s3cr3t-token-0123456789abcdefghijklmnop", t))
        assertFalse(Security.tokenMatches("s3cr3t-token-0123456789abcdefghijklmnop", t))
    }
}
