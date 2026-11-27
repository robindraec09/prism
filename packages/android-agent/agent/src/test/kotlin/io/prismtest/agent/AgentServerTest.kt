package io.prismtest.agent

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.Socket

/** Real sockets on the JVM: exercises section 11 checks and keep-alive end to end. */
class AgentServerTest {
    private val token = "tok_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"
    private lateinit var server: AgentServer
    private var port = 0

    @Before
    fun setUp() {
        server = AgentServer(0, token, Dispatcher(loginScreen(), "k7q2xm4p", SilentLog()), SilentLog())
        port = server.start()
    }

    @After
    fun tearDown() {
        server.stop("test done")
    }

    private fun raw(request: String): String = Socket("127.0.0.1", port).use { s ->
        s.getOutputStream().write(request.toByteArray())
        s.getOutputStream().flush()
        val r = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
        val status = r.readLine()
        var length = 0
        while (true) {
            val line = r.readLine() ?: break
            if (line.isEmpty()) break
            if (line.startsWith("Content-Length:")) length = line.substringAfter(':').trim().toInt()
        }
        val body = CharArray(length)
        var read = 0
        while (read < length) {
            val n = r.read(body, read, length - read)
            if (n < 0) break
            read += n
        }
        status + "\n" + String(body, 0, read)
    }

    private fun get(path: String, headers: String) = raw("GET $path HTTP/1.1\r\n$headers\r\nConnection: close\r\n\r\n")

    @Test
    fun versionWithTokenAndLoopbackHost() {
        val r = get("/version", "Host: 127.0.0.1:52817\r\nAuthorization: Bearer $token")
        assertTrue(r, r.startsWith("HTTP/1.1 200"))
        assertTrue(r.contains("\"instanceId\":\"k7q2xm4p\""))
    }

    @Test
    fun rejectsMissingTokenOriginAndForeignHost() {
        assertTrue(get("/version", "Host: 127.0.0.1").startsWith("HTTP/1.1 401"))
        assertTrue(get("/version", "Host: 127.0.0.1\r\nAuthorization: Bearer nope").startsWith("HTTP/1.1 401"))
        assertTrue(get("/version", "Host: evil.example:7100\r\nAuthorization: Bearer $token").startsWith("HTTP/1.1 403"))
        assertTrue(get("/version", "Host: localhost\r\nOrigin: http://evil.example\r\nAuthorization: Bearer $token").startsWith("HTTP/1.1 403"))
    }

    @Test
    fun routesHealthCommandAndUnknownPaths() {
        val auth = "Host: localhost:7100\r\nAuthorization: Bearer $token"
        val health = get("/v1/health", auth)
        assertTrue(health.contains("\"ok\":true") && health.contains("\"running\":null"))
        assertTrue(get("/v2/command", auth).startsWith("HTTP/1.1 404"))
        assertTrue(get("/v1/command", auth).startsWith("HTTP/1.1 405"))
        val body = """{"v":"1.0","id":"r-1","cmd":"session.start","params":{}}"""
        val r = raw("POST /v1/command HTTP/1.1\r\n$auth\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body")
        assertTrue(r, r.startsWith("HTTP/1.1 200") && r.contains("\"session\":\"k7q2xm4p.sess-1\""))
    }

    @Test
    fun keepsTheConnectionAliveAcrossRequests() {
        Socket("127.0.0.1", port).use { s ->
            val out = s.getOutputStream()
            val input = s.getInputStream()
            repeat(3) {
                out.write("GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer $token\r\n\r\n".toByteArray())
                out.flush()
                val head = StringBuilder()
                while (!head.endsWith("\r\n\r\n")) head.append(input.read().toChar())
                val len = Regex("Content-Length: (\\d+)").find(head)!!.groupValues[1].toInt()
                val body = ByteArray(len)
                var read = 0
                while (read < len) read += input.read(body, read, len - read)
                assertTrue(head.startsWith("HTTP/1.1 200"))
                assertEquals('}', String(body).last())
            }
        }
    }
}
