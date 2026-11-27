package io.prismtest.agent

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.zip.GZIPOutputStream

/** One parsed HTTP/1.1 request. Header names are lower-cased. */
class HttpRequest(
    val method: String,
    val path: String,
    val version: String,
    val headers: Map<String, String>,
    val body: ByteArray,
) {
    fun header(name: String): String? = headers[name.lowercase()]

    /** HTTP/1.1 keeps the connection open unless the client says `Connection: close`. */
    val keepAlive: Boolean
        get() {
            val c = header("connection")?.lowercase()
            return if (version == "HTTP/1.0") c == "keep-alive" else c != "close"
        }
}

/** A request that must be answered with a bare status (no protocol envelope), then closed. */
class HttpError(val status: Int, message: String) : Exception(message)

/**
 * Tiny HTTP/1.1 codec on plain streams: enough for the agent protocol (Content-Length bodies,
 * keep-alive, gzip responses). No chunked request bodies: the host never sends them.
 */
object HttpCodec {
    const val MAX_BODY_BYTES = 1024 * 1024 // protocol.md 4.1
    private const val MAX_LINE = 8192
    private const val MAX_HEADERS = 100
    private const val GZIP_MIN_BYTES = 1024

    /** Reads one request, or returns null when the peer closed the connection between requests. */
    fun readRequest(input: InputStream, maxBody: Int = MAX_BODY_BYTES): HttpRequest? {
        val requestLine = readLine(input, allowEof = true) ?: return null
        val parts = requestLine.split(' ')
        if (parts.size != 3 || !parts[2].startsWith("HTTP/1.")) throw HttpError(400, "Bad request line")
        val headers = HashMap<String, String>()
        while (true) {
            val line = readLine(input, allowEof = false)!!
            if (line.isEmpty()) break
            if (headers.size >= MAX_HEADERS) throw HttpError(431, "Too many headers")
            val idx = line.indexOf(':')
            if (idx <= 0) throw HttpError(400, "Bad header line")
            val name = line.substring(0, idx).trim().lowercase()
            val value = line.substring(idx + 1).trim()
            // Repeated headers are joined, as RFC 9110 allows for list-valued fields. A repeated
            // Host or Authorization is therefore never accepted by the checks in Security.
            headers[name] = headers[name]?.let { "$it, $value" } ?: value
        }
        if (headers.containsKey("transfer-encoding")) throw HttpError(501, "Chunked bodies are not supported")
        val length = headers["content-length"]?.let {
            it.toIntOrNull()?.takeIf { n -> n >= 0 } ?: throw HttpError(400, "Bad Content-Length")
        } ?: 0
        if (length > maxBody) throw HttpError(413, "Body larger than $maxBody bytes")
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) throw HttpError(400, "Body shorter than Content-Length")
            read += n
        }
        val target = parts[1]
        val path = target.substringBefore('?')
        return HttpRequest(parts[0], path, parts[2], headers, body)
    }

    private fun readLine(input: InputStream, allowEof: Boolean): String? {
        val buf = ByteArrayOutputStream(128)
        while (true) {
            val b = input.read()
            if (b < 0) {
                if (allowEof && buf.size() == 0) return null
                throw HttpError(400, "Unexpected end of request")
            }
            if (b == '\n'.code) break
            if (b != '\r'.code) buf.write(b)
            if (buf.size() > MAX_LINE) throw HttpError(431, "Header line too long")
        }
        return buf.toString("ISO-8859-1")
    }

    fun acceptsGzip(req: HttpRequest): Boolean =
        req.header("accept-encoding")?.split(',')?.any { it.trim().substringBefore(';').equals("gzip", true) } == true

    fun writeResponse(
        out: OutputStream,
        status: Int,
        body: ByteArray,
        contentType: String? = "application/json; charset=utf-8",
        gzip: Boolean = false,
        keepAlive: Boolean = true,
    ) {
        var payload = body
        var encoded = false
        if (gzip && body.size >= GZIP_MIN_BYTES) {
            val bos = ByteArrayOutputStream(body.size / 4 + 64)
            GZIPOutputStream(bos).use { it.write(body) }
            payload = bos.toByteArray()
            encoded = true
        }
        val sb = StringBuilder(160)
        sb.append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n")
        if (contentType != null && payload.isNotEmpty()) sb.append("Content-Type: ").append(contentType).append("\r\n")
        if (encoded) sb.append("Content-Encoding: gzip\r\n")
        sb.append("Content-Length: ").append(payload.size).append("\r\n")
        sb.append("Cache-Control: no-store\r\n")
        sb.append(if (keepAlive) "Connection: keep-alive\r\n" else "Connection: close\r\n")
        sb.append("\r\n")
        out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
        out.write(payload)
        out.flush()
    }

    fun reason(status: Int): String = when (status) {
        200 -> "OK"
        400 -> "Bad Request"
        401 -> "Unauthorized"
        403 -> "Forbidden"
        404 -> "Not Found"
        405 -> "Method Not Allowed"
        413 -> "Payload Too Large"
        431 -> "Request Header Fields Too Large"
        500 -> "Internal Server Error"
        501 -> "Not Implemented"
        503 -> "Service Unavailable"
        else -> "Status"
    }
}

/** Request checks from protocol.md section 11. */
object Security {
    private val ALLOWED_HOSTNAMES = setOf("127.0.0.1", "localhost", "[::1]")

    /**
     * True when the `Host` header names a loopback hostname. Any port is accepted, because
     * `adb forward` delivers requests addressed to a different host-side port.
     */
    fun hostAllowed(host: String?): Boolean {
        if (host.isNullOrEmpty()) return false
        val hostname: String
        val rest: String
        if (host.startsWith("[")) {
            val end = host.indexOf(']')
            if (end < 0) return false
            hostname = host.substring(0, end + 1)
            rest = host.substring(end + 1)
        } else {
            val colon = host.indexOf(':')
            hostname = if (colon < 0) host else host.substring(0, colon)
            rest = if (colon < 0) "" else host.substring(colon)
        }
        if (rest.isNotEmpty()) {
            if (!rest.startsWith(":")) return false
            val port = rest.substring(1)
            if (port.isEmpty() || port.length > 5 || !port.all { it in '0'..'9' }) return false
        }
        return hostname.lowercase() in ALLOWED_HOSTNAMES
    }

    /** Compares `Authorization: Bearer <token>` with the expected token in constant time. */
    fun tokenMatches(authorization: String?, expected: ByteArray): Boolean {
        if (authorization == null) return false
        val space = authorization.indexOf(' ')
        if (space < 0) return false
        if (!authorization.substring(0, space).equals("Bearer", ignoreCase = true)) return false
        val given = authorization.substring(space + 1).trim().toByteArray(Charsets.UTF_8)
        return MessageDigest.isEqual(given, expected)
    }
}
