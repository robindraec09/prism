package io.prismtest.agent

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/**
 * The agent's HTTP/1.1 server (protocol.md 4.1, 11), on `java.net.ServerSocket` with no
 * third-party code. Binds 127.0.0.1 only. Connections are handled on a small thread pool; commands
 * are serialised by [Dispatcher].
 */
class AgentServer(
    private val port: Int,
    token: String,
    private val dispatcher: Dispatcher,
    private val log: AgentLog,
    private val idleTimeoutMs: Long = 30 * 60_000L,
) {
    private val tokenBytes = token.toByteArray(Charsets.UTF_8)
    private val connections = Executors.newCachedThreadPool { r -> Thread(r, "prism-http").apply { isDaemon = true } }
    private val slots = Semaphore(MAX_CONNECTIONS)
    private val stopped = CountDownLatch(1)
    private lateinit var server: ServerSocket

    @Volatile private var lastRequestMs = System.currentTimeMillis()

    @Volatile var stopReason: String? = null
        private set

    /** Binds the socket and starts accepting. Returns the bound port. */
    fun start(): Int {
        val s = ServerSocket()
        s.reuseAddress = true
        s.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 16)
        server = s
        Thread({ acceptLoop() }, "prism-accept").apply { isDaemon = true }.start()
        Thread({ idleWatch() }, "prism-idle").apply { isDaemon = true }.start()
        return s.localPort
    }

    /** Blocks until [stop] is called or the idle timeout fires. */
    fun awaitStop() = stopped.await()

    fun stop(reason: String) {
        if (stopped.count == 0L) return
        stopReason = reason
        log.info("Prism agent stopping: $reason")
        try {
            server.close()
        } catch (_: IOException) {
        }
        connections.shutdownNow()
        dispatcher.shutdown()
        stopped.countDown()
    }

    private fun idleWatch() {
        while (!stopped.await(1, TimeUnit.SECONDS)) {
            if (System.currentTimeMillis() - lastRequestMs > idleTimeoutMs) {
                stop("no request for $idleTimeoutMs ms")
            }
        }
    }

    private fun acceptLoop() {
        while (!server.isClosed) {
            val socket = try {
                server.accept()
            } catch (e: IOException) {
                if (!server.isClosed) log.warn("accept failed", e)
                continue
            }
            if (!slots.tryAcquire()) {
                socket.close() // too many connections; the host uses one or two
                continue
            }
            try {
                connections.execute {
                    try {
                        serve(socket)
                    } finally {
                        slots.release()
                    }
                }
            } catch (e: Exception) {
                slots.release()
                socket.close()
            }
        }
    }

    private fun serve(socket: Socket) {
        socket.use { s ->
            s.tcpNoDelay = true
            s.soTimeout = KEEP_ALIVE_MS
            val input = BufferedInputStream(s.getInputStream())
            val output = BufferedOutputStream(s.getOutputStream())
            while (true) {
                val req = try {
                    HttpCodec.readRequest(input) ?: return
                } catch (e: HttpError) {
                    HttpCodec.writeResponse(output, e.status, ByteArray(0), keepAlive = false)
                    return
                } catch (_: SocketTimeoutException) {
                    return
                } catch (_: SocketException) {
                    return
                }
                val keepAlive = req.keepAlive
                val (status, body) = route(req)
                HttpCodec.writeResponse(
                    output,
                    status,
                    body,
                    gzip = HttpCodec.acceptsGzip(req),
                    keepAlive = keepAlive,
                )
                if (!keepAlive) return
            }
        }
    }

    /** Applies the section 11 checks, then routes. Returns status and body. */
    internal fun route(req: HttpRequest): Pair<Int, ByteArray> {
        // Browsers always send Origin on cross-origin requests; the host never does.
        if (req.header("origin") != null) return 403 to EMPTY
        if (!Security.hostAllowed(req.header("host"))) return 403 to EMPTY
        if (!Security.tokenMatches(req.header("authorization"), tokenBytes)) return 401 to EMPTY
        lastRequestMs = System.currentTimeMillis()
        return when (req.path) {
            "/version" -> if (req.method == "GET") 200 to json(dispatcher.versionBody()) else 405 to EMPTY
            "/v1/health" -> if (req.method == "GET") 200 to json(dispatcher.healthBody()) else 405 to EMPTY
            "/v1/command" -> if (req.method == "POST") 200 to json(dispatcher.handle(req.body)) else 405 to EMPTY
            // /v1/events and /v1/artifacts are not part of the P0-09 spike.
            else -> 404 to EMPTY
        }
    }

    private fun json(m: Map<String, Any?>) = Json.write(m).toByteArray(Charsets.UTF_8)

    companion object {
        private val EMPTY = ByteArray(0)
        const val MAX_CONNECTIONS = 8
        const val KEEP_ALIVE_MS = 120_000
    }
}
