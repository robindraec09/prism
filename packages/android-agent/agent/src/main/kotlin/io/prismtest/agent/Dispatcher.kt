package io.prismtest.agent

import java.util.concurrent.ExecutionException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference

/** Logging seam so the protocol layer does not depend on `android.util.Log`. */
interface AgentLog {
    fun info(msg: String)

    fun warn(msg: String, t: Throwable? = null)
}

/**
 * Executes protocol commands (protocol.md 6, 7) against a [DeviceBackend].
 *
 * Commands run one at a time on a single executor thread (4.2). The server thread that received
 * the request waits for the result up to `timeoutMs`; a second command while one is running gets
 * `busy`. `/version` and `/v1/health` never touch the executor.
 */
class Dispatcher(
    private val device: DeviceBackend,
    val instanceId: String = Ids.newInstanceId(),
    private val log: AgentLog,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private class Running(val id: String, val cmd: String, val startedMs: Long)

    private val executor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "prism-executor").apply { isDaemon = true }
    }
    private val running = AtomicReference<Running?>(null)
    private val startedAtMs = clock()

    @Volatile private var session: String? = null
    private var sessionCounter = 0
    private var snapshotCounter = 0

    fun versionBody(): Map<String, Any?> = linkedMapOf(
        "protocol" to linkedMapOf("min" to ProtocolInfo.MIN.toString(), "max" to ProtocolInfo.MAX.toString()),
        "agent" to linkedMapOf(
            "name" to ProtocolInfo.AGENT_NAME,
            "version" to ProtocolInfo.AGENT_VERSION,
            "instanceId" to instanceId,
        ),
    )

    fun healthBody(): Map<String, Any?> {
        val r = running.get()
        return linkedMapOf(
            "ok" to true,
            "instanceId" to instanceId,
            "uptimeMs" to (clock() - startedAtMs),
            "session" to session,
            "running" to r?.let { linkedMapOf("id" to it.id, "cmd" to it.cmd, "forMs" to (clock() - it.startedMs)) },
        )
    }

    fun shutdown() {
        executor.shutdownNow()
    }

    /** Handles a `POST /v1/command` body and returns the response envelope (always HTTP 200). */
    fun handle(body: ByteArray): Map<String, Any?> {
        val startedMs = clock()
        val startedNs = System.nanoTime()
        var v = ProtocolInfo.MAX.toString()
        var id = ""
        fun timing(): Map<String, Any?> = linkedMapOf(
            "startedAt" to Ids.timestamp(startedMs),
            "durationMs" to round2((System.nanoTime() - startedNs) / 1e6),
        )
        fun fail(e: ProtocolError): Map<String, Any?> =
            linkedMapOf("v" to v, "id" to id, "ok" to false, "error" to e.toJson(), "timing" to timing())

        val req: Map<String, Any?>
        try {
            val parsed = Json.parse(String(body, Charsets.UTF_8))
            @Suppress("UNCHECKED_CAST")
            req = parsed as? Map<String, Any?> ?: throw ProtocolError.invalid("body", "Request body must be a JSON object.")
        } catch (e: Json.ParseException) {
            return fail(ProtocolError.invalid("body", "Request body is not valid JSON: ${e.message}."))
        } catch (e: ProtocolError) {
            return fail(e)
        }
        (req["id"] as? String)?.let { id = it }
        (req["v"] as? String)?.let { v = it }

        val cmd: String
        val params: Params
        val timeoutMs: Long
        try {
            val env = Params(req)
            val reqV = env.requireString("v")
            val parsedV = ProtocolVersion.parse(reqV)
                ?: throw ProtocolError.invalid("v", "Field 'v' must be MAJOR.MINOR, got '$reqV'.")
            if (env.requireString("id").isEmpty()) throw ProtocolError.invalid("id", "Field 'id' must not be empty.")
            cmd = env.requireString("cmd")
            params = env.requireObj("params")
            if (cmd != "hello" && (parsedV.major != ProtocolInfo.MAX.major || parsedV > ProtocolInfo.MAX)) {
                throw ProtocolError(
                    "version-mismatch",
                    "Request uses protocol $reqV but this agent supports ${ProtocolInfo.MIN}..${ProtocolInfo.MAX}. Send hello and use the selected version.",
                    false,
                    mapOf("agent" to mapOf("min" to ProtocolInfo.MIN.toString(), "max" to ProtocolInfo.MAX.toString())),
                )
            }
            timeoutMs = env.int("timeoutMs", min = 1) ?: DEFAULT_TIMEOUT_MS
            if (cmd !in NO_SESSION_COMMANDS) checkSession(env.string("session"))
        } catch (e: ProtocolError) {
            return fail(e)
        }

        if (cmd == "session.stop") {
            // Answered on the server thread, never waits for the executor (protocol.md 4.2). The
            // spike has no cancellation: a command still running finishes and its result is dropped.
            session = null
            return linkedMapOf("v" to v, "id" to id, "ok" to true, "result" to emptyMap<String, Any?>(), "timing" to timing())
        }

        val handler = handlerFor(cmd) ?: return fail(
            if (cmd in V1_COMMANDS) {
                ProtocolError.unsupported(cmd, "Command '$cmd' is part of protocol 1.0 but not implemented by the P0-09 spike agent.")
            } else {
                ProtocolError("unknown-command", "Command '$cmd' does not exist in protocol $v.", false, mapOf("cmd" to cmd))
            },
        )

        val me = Running(id, cmd, startedMs)
        if (!running.compareAndSet(null, me)) {
            val r = running.get()
            return fail(
                ProtocolError(
                    "busy",
                    "The agent is still running '${r?.cmd}' (request ${r?.id}). Poll /v1/health until 'running' is null, then retry.",
                    true,
                    linkedMapOf("runningId" to r?.id, "runningCmd" to r?.cmd, "runningForMs" to r?.let { clock() - it.startedMs }),
                ),
            )
        }
        val future = try {
            executor.submit<Map<String, Any?>> {
                try {
                    handler(params)
                } finally {
                    running.compareAndSet(me, null)
                }
            }
        } catch (e: Exception) {
            running.compareAndSet(me, null)
            return fail(ProtocolError("internal", "Executor rejected the command: $e", false))
        }
        return try {
            val result = future.get(timeoutMs, TimeUnit.MILLISECONDS)
            linkedMapOf("v" to v, "id" to id, "ok" to true, "result" to result, "timing" to timing())
        } catch (e: TimeoutException) {
            fail(
                ProtocolError(
                    "timeout",
                    "Command '$cmd' did not finish within ${timeoutMs} ms.",
                    cmd in READ_ONLY_COMMANDS,
                    mapOf("timeoutMs" to timeoutMs),
                ),
            )
        } catch (e: ExecutionException) {
            when (val cause = e.cause) {
                is ProtocolError -> fail(cause)
                else -> {
                    log.warn("Command $cmd failed", cause)
                    fail(
                        ProtocolError(
                            "internal",
                            "Unexpected agent exception in '$cmd': $cause. Report this as a Prism bug with the agent log.",
                            false,
                            linkedMapOf(
                                "exception" to cause?.javaClass?.name,
                                "exceptionMessage" to cause?.message,
                                "stack" to cause?.stackTrace?.take(15)?.map { it.toString() },
                            ),
                        ),
                    )
                }
            }
        }
    }

    private fun checkSession(s: String?) {
        if (s == null) throw ProtocolError.invalid("session", "Field 'session' is required for this command; call session.start first.")
        if (s != session) {
            val other = !s.startsWith("$instanceId.")
            throw ProtocolError(
                "session-not-found",
                if (other) "Session '$s' belongs to another agent process (this agent is $instanceId); the agent restarted. Start a new session."
                else "Session '$s' is not active. Start a new session.",
                false,
                linkedMapOf("session" to s, "instanceId" to instanceId),
            )
        }
    }

    private fun handlerFor(cmd: String): ((Params) -> Map<String, Any?>)? = when (cmd) {
        "hello" -> ::hello
        "device.info" -> { _ -> deviceInfoJson() }
        "session.start" -> ::sessionStart
        "tree.get" -> ::treeGet
        "action.tap" -> ::tap
        else -> null
    }

    // ---- hello / device / session -------------------------------------------------------------

    private fun hello(p: Params): Map<String, Any?> {
        val client = p.requireObj("client")
        client.requireString("name")
        client.requireString("version")
        val range = p.requireObj("protocol")
        val min = ProtocolVersion.parse(range.requireString("min"))
            ?: throw ProtocolError.invalid("protocol.min", "protocol.min must be MAJOR.MINOR.")
        val max = ProtocolVersion.parse(range.requireString("max"))
            ?: throw ProtocolError.invalid("protocol.max", "protocol.max must be MAJOR.MINOR.")
        if (min > max) throw ProtocolError.invalid("protocol", "protocol.min must not be greater than protocol.max.")
        val selected = negotiate(min, max) ?: throw ProtocolError(
            "version-mismatch",
            "No common protocol version: host supports $min..$max, agent supports ${ProtocolInfo.MIN}..${ProtocolInfo.MAX}. Reinstall the agent bundled with this host.",
            false,
            linkedMapOf(
                "host" to linkedMapOf("min" to min.toString(), "max" to max.toString()),
                "agent" to linkedMapOf("min" to ProtocolInfo.MIN.toString(), "max" to ProtocolInfo.MAX.toString()),
            ),
        )
        return linkedMapOf(
            "protocol" to linkedMapOf(
                "selected" to selected.toString(),
                "min" to ProtocolInfo.MIN.toString(),
                "max" to ProtocolInfo.MAX.toString(),
            ),
            "agent" to linkedMapOf(
                "name" to ProtocolInfo.AGENT_NAME,
                "version" to ProtocolInfo.AGENT_VERSION,
                "platform" to "android",
                "instanceId" to instanceId,
            ),
            "capabilities" to ProtocolInfo.CAPABILITIES,
            "device" to deviceInfoJson(),
        )
    }

    private fun deviceInfoJson(): Map<String, Any?> {
        val d = device.deviceInfo()
        return linkedMapOf(
            "platform" to "android",
            "osVersion" to d.osVersion,
            "apiLevel" to d.apiLevel,
            "model" to d.model,
            "emulator" to d.emulator,
            "screen" to device.screen().toJson(),
            "locale" to d.locale,
            "timeZone" to d.timeZone,
        )
    }

    private fun sessionStart(p: Params): Map<String, Any?> {
        if (p.has("app")) {
            throw ProtocolError.unsupported("session.start.app", "session.start with 'app' is not implemented in the P0-09 spike; launch the app with adb first.")
        }
        val current = session
        if (current != null && p.bool("replace") != true) {
            throw ProtocolError("session-active", "Session $current is already active. Stop it, or send replace: true.", false, mapOf("session" to current))
        }
        sessionCounter++
        val s = "$instanceId.sess-$sessionCounter"
        session = s
        return linkedMapOf("session" to s)
    }

    // ---- tree.get -----------------------------------------------------------------------------

    private fun treeGet(p: Params): Map<String, Any?> {
        if (p.has("root")) throw ProtocolError.unsupported("tree.get.root", "tree.get with 'root' is not implemented in the P0-09 spike.")
        if (p.has("since")) throw ProtocolError.unsupported("tree.diff", "This agent does not advertise tree.diff; request a full snapshot.")
        val delivery = p.enum("delivery", listOf("inline", "artifact"))
        if (delivery == "artifact") throw ProtocolError.unsupported("tree.get.delivery.artifact", "Artifact delivery is not implemented in the P0-09 spike; use inline.")
        val opts = TreeOptions(
            maxDepth = p.int("maxDepth", min = 0)?.let { it.coerceAtMost(Int.MAX_VALUE.toLong()).toInt() },
            maxNodes = (p.int("maxNodes", min = 1) ?: 5000L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
            visibleOnly = p.obj("filter")?.bool("visibleOnly") ?: false,
            includeRaw = p.obj("include")?.bool("raw") ?: true,
            includeWebContent = p.enum("webContent", listOf("prune", "include")) == "include",
        )
        val idle = settle(p.obj("settle"))

        // One traversal; if the UI changed while we walked it, retry once (protocol.md 9.1, 1).
        var attempt = 0
        var changed: Boolean
        var built: Pair<TreeBuilder, Map<String, Any?>>
        var capturedAt: Long
        do {
            val t0 = device.uptimeMs()
            capturedAt = clock()
            val screen = device.screen()
            val b = TreeBuilder(opts, screen)
            val root = b.build(device.windows())
            built = b to root
            changed = device.lastContentChangeMs() > t0
            attempt++
        } while (changed && attempt < 2)

        val (builder, root) = built
        snapshotCounter++
        val result = linkedMapOf<String, Any?>(
            "snapshotId" to "$instanceId.s-$snapshotCounter",
            "capturedAt" to Ids.timestamp(capturedAt),
            "platform" to "android",
            "screen" to device.screen().toJson(),
        )
        when {
            idle != null -> result["idle"] = if (changed) idle + ("settled" to false) else idle
            changed -> result["idle"] = linkedMapOf("settled" to false, "waitedMs" to 0)
        }
        result["root"] = root
        result["nodeCount"] = builder.nodeCount
        result["truncated"] = builder.truncated
        return result
    }

    private fun settle(s: Params?): Map<String, Any?>? {
        if (s == null) return null
        val maxWait = s.int("maxWaitMs", min = 0) ?: throw ProtocolError.invalid("settle.maxWaitMs", "settle.maxWaitMs is required.")
        val quiet = s.int("quietMs", min = 0) ?: 50L
        val t0 = System.nanoTime()
        val settled = device.waitForIdle(quiet, maxWait)
        return linkedMapOf("settled" to settled, "waitedMs" to round2((System.nanoTime() - t0) / 1e6))
    }

    // ---- action.tap ---------------------------------------------------------------------------

    private fun tap(p: Params): Map<String, Any?> {
        val target = p.requireObj("target")
        if (target.has("node") || target.has("locator")) {
            throw ProtocolError.unsupported(
                "action.tap.target." + (if (target.has("node")) "node" else "locator"),
                "The P0-09 spike agent only taps point targets; resolve the node on the host and send its centre as a point.",
            )
        }
        val point = target.obj("point") ?: throw ProtocolError.invalid("target", "target must have exactly one of node, locator, point.")
        val x = point.requireNumber("x")
        val y = point.requireNumber("y")
        val checks = p.obj("checks")
        if (checks?.has("within") == true) {
            throw ProtocolError.unsupported("action.tap.checks.within", "checks.within is not implemented in the P0-09 spike.")
        }
        // Element checks do not apply to point targets (protocol.md 7.1).
        val screen = device.screen()
        if (x < 0 || y < 0 || x >= screen.widthDip || y >= screen.heightDip) {
            throw ProtocolError.invalid(
                "target.point",
                "Point (${fmt(x)}, ${fmt(y)}) is outside the screen (${fmt(screen.widthDip)} x ${fmt(screen.heightDip)} DIP).",
            )
        }
        val idle = settle(p.obj("settle"))
        val t0 = System.nanoTime()
        device.tap((x * screen.density).toFloat(), (y * screen.density).toFloat(), TAP_DOWN_MS)
        val result = linkedMapOf<String, Any?>(
            "at" to linkedMapOf("x" to x, "y" to y),
            "durationMs" to round2((System.nanoTime() - t0) / 1e6),
        )
        if (idle != null) result["idle"] = idle
        return result
    }

    private fun fmt(d: Double): String = Json.write(round2(d))

    companion object {
        const val DEFAULT_TIMEOUT_MS = 10_000L
        const val TAP_DOWN_MS = 50L

        val NO_SESSION_COMMANDS = setOf("hello", "session.start", "device.info")

        /** Commands that do not change state: a `timeout` on them is retryable (6.3). */
        val READ_ONLY_COMMANDS = setOf(
            "hello", "tree.get", "element.find", "element.hitTest", "screen.screenshot", "device.info",
            "alert.get", "keyboard.state", "idle.wait",
        )

        /** Every command of protocol 1.0 (7.1); the ones not handled answer `unsupported`. */
        val V1_COMMANDS = setOf(
            "hello", "session.start", "session.stop", "device.info", "tree.get", "action.tap", "screen.screenshot",
            "element.find", "element.scrollIntoView", "element.hitTest", "action.doubleTap", "action.longPress",
            "action.type", "action.clear", "action.setValue", "action.swipe", "action.scroll", "action.drag",
            "action.pinch", "action.pressKey", "action.back", "action.home", "keyboard.state", "keyboard.hide",
            "idle.wait", "app.launch", "app.terminate", "app.state", "context.list", "alert.get", "alert.accept",
            "alert.dismiss", "metrics.start", "metrics.stop",
        )
    }
}
