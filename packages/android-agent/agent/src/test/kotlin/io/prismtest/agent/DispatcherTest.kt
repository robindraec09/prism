package io.prismtest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CompletableFuture

class DispatcherTest {
    private fun dispatcher(device: FakeDevice = loginScreen()) = Dispatcher(device, "k7q2xm4p", SilentLog())

    private fun Dispatcher.call(cmd: String, params: Map<String, Any?> = emptyMap(), session: String? = null, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> {
        val req = linkedMapOf<String, Any?>("v" to "1.0", "id" to "r-$cmd", "cmd" to cmd, "params" to params)
        if (session != null) req["session"] = session
        req.putAll(extra)
        return handle(Json.write(req).toByteArray())
    }

    private fun Map<String, Any?>.errorCode() = this["error"].obj()["code"]

    private val hello = mapOf(
        "client" to mapOf("name" to "@prismtest/android", "version" to "0.1.0"),
        "protocol" to mapOf("min" to "1.0", "max" to "1.3"),
        "want" to listOf("tree.diff"),
    )

    @Test
    fun helloNegotiatesAndDescribesTheDevice() {
        val r = dispatcher().call("hello", hello)
        assertEquals(true, r["ok"])
        assertEquals("r-hello", r["id"])
        val result = r["result"].obj()
        assertEquals("1.0", result["protocol"].obj()["selected"])
        assertEquals("k7q2xm4p", result["agent"].obj()["instanceId"])
        assertEquals("android", result["agent"].obj()["platform"])
        assertFalse(result["capabilities"].list().contains("tree.diff"))
        val device = result["device"].obj()
        assertEquals(34, device["apiLevel"])
        assertEquals(mapOf("width" to 360.0, "height" to 800.0, "scale" to 3.0, "rotation" to 0, "orientation" to "portrait"), device["screen"])
        assertTrue(r["timing"].obj()["startedAt"].toString().matches(Regex("""\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z""")))
    }

    @Test
    fun helloWithoutOverlapIsVersionMismatch() {
        val r = dispatcher().call("hello", hello + ("protocol" to mapOf("min" to "2.0", "max" to "2.1")))
        assertEquals("version-mismatch", r.errorCode())
        assertEquals(mapOf("min" to "2.0", "max" to "2.1"), r["error"].obj()["details"].obj()["host"])
    }

    @Test
    fun malformedRequestsAreInvalid() {
        val d = dispatcher()
        assertEquals("invalid-request", d.handle("not json".toByteArray()).errorCode())
        assertEquals("invalid-request", d.handle("""{"v":"1.0","id":"x","cmd":"hello"}""".toByteArray()).errorCode())
        assertEquals("invalid-request", d.call("hello", mapOf("client" to mapOf("name" to "x"))).errorCode())
        val r = d.call("tree.get", session = null)
        assertEquals("invalid-request", r.errorCode())
        assertEquals("session", r["error"].obj()["details"].obj()["param"])
    }

    @Test
    fun sessionLifecycle() {
        val d = dispatcher()
        val s = d.call("session.start")["result"].obj()["session"]
        assertEquals("k7q2xm4p.sess-1", s)
        assertEquals("session-active", d.call("session.start").errorCode())
        assertEquals("k7q2xm4p.sess-2", d.call("session.start", mapOf("replace" to true))["result"].obj()["session"])
        assertEquals("session-not-found", d.call("tree.get", session = "k7q2xm4p.sess-1").errorCode())
        assertEquals("session-not-found", d.call("tree.get", session = "zzzzzzzz.sess-2").errorCode())
        assertEquals(true, d.call("session.stop", session = "k7q2xm4p.sess-2")["ok"])
        assertEquals(null, d.healthBody()["session"])
    }

    @Test
    fun treeGetReturnsInstanceScopedSnapshots() {
        val d = dispatcher()
        val s = d.call("session.start")["result"].obj()["session"] as String
        val r1 = d.call("tree.get", session = s)["result"].obj()
        val r2 = d.call("tree.get", mapOf("settle" to mapOf("maxWaitMs" to 200, "quietMs" to 50)), session = s)["result"].obj()
        assertEquals("k7q2xm4p.s-1", r1["snapshotId"])
        assertEquals("k7q2xm4p.s-2", r2["snapshotId"])
        assertEquals("android", r1["platform"])
        assertEquals(6, r1["nodeCount"])
        assertEquals(false, r1["truncated"])
        assertEquals("screen", r1["root"].obj()["role"])
        assertEquals(true, r2["idle"].obj()["settled"])
    }

    @Test
    fun treeGetRetriesOnceWhenTheUiChangesAndReportsNotSettled() {
        val device = loginScreen().apply { changeDuringCapture = true }
        val d = dispatcher(device)
        val s = d.call("session.start")["result"].obj()["session"] as String
        val r = d.call("tree.get", session = s)["result"].obj()
        assertEquals(false, r["idle"].obj()["settled"])
    }

    @Test
    fun treeGetValidatesOptions() {
        val d = dispatcher()
        val s = d.call("session.start")["result"].obj()["session"] as String
        val bad = d.call("tree.get", mapOf("webContent" to "all"), session = s)
        assertEquals("invalid-request", bad.errorCode())
        assertEquals(listOf("prune", "include"), bad["error"].obj()["details"].obj()["allowed"])
        assertEquals("unsupported", d.call("tree.get", mapOf("since" to "k7q2xm4p.s-1"), session = s).errorCode())
        assertEquals("unsupported", d.call("tree.get", mapOf("delivery" to "artifact"), session = s).errorCode())
    }

    @Test
    fun tapConvertsDipToPixels() {
        val device = loginScreen()
        val d = dispatcher(device)
        val s = d.call("session.start")["result"].obj()["session"] as String
        val r = d.call("action.tap", mapOf("target" to mapOf("point" to mapOf("x" to 180, "y" to 524))), session = s)
        assertEquals(true, r["ok"])
        assertEquals(mapOf("x" to 180.0, "y" to 524.0), r["result"].obj()["at"])
        assertEquals(listOf(Triple(540f, 1572f, Dispatcher.TAP_DOWN_MS)), device.taps)
    }

    @Test
    fun tapRejectsOffScreenPointsAndUnsupportedTargets() {
        val device = loginScreen()
        val d = dispatcher(device)
        val s = d.call("session.start")["result"].obj()["session"] as String
        assertEquals("invalid-request", d.call("action.tap", mapOf("target" to mapOf("point" to mapOf("x" to 360, "y" to 10))), session = s).errorCode())
        assertEquals("invalid-request", d.call("action.tap", mapOf("target" to mapOf("point" to mapOf("x" to "a", "y" to 10))), session = s).errorCode())
        val node = mapOf("target" to mapOf("node" to mapOf("snapshotId" to "k7q2xm4p.s-1", "nodeId" to "n5")))
        assertEquals("unsupported", d.call("action.tap", node, session = s).errorCode())
        assertTrue(device.taps.isEmpty())
    }

    @Test
    fun unknownAndUnimplementedCommands() {
        val d = dispatcher()
        val s = d.call("session.start")["result"].obj()["session"] as String
        assertEquals("unknown-command", d.call("action.teleport", session = s).errorCode())
        assertEquals("unsupported", d.call("element.find", session = s).errorCode())
    }

    @Test
    fun secondCommandWhileBusyGetsBusyAndSlowCommandTimesOut() {
        val device = loginScreen().apply { tapDelayMs = 600 }
        val d = dispatcher(device)
        val s = d.call("session.start")["result"].obj()["session"] as String
        val tap = mapOf("target" to mapOf("point" to mapOf("x" to 10, "y" to 10)))
        val first = CompletableFuture.supplyAsync { d.call("action.tap", tap, session = s, extra = mapOf("timeoutMs" to 250)) }
        Thread.sleep(100)
        val second = d.call("tree.get", session = s)
        assertEquals("busy", second.errorCode())
        assertEquals(true, second["error"].obj()["retryable"])
        assertEquals("action.tap", second["error"].obj()["details"].obj()["runningCmd"])
        val r = first.get()
        assertEquals("timeout", r.errorCode())
        assertEquals(false, r["error"].obj()["retryable"]) // actions may already have happened
        assertEquals("action.tap", d.healthBody()["running"].obj()["cmd"])
        Thread.sleep(700)
        assertEquals(null, d.healthBody()["running"])
    }

    @Test
    fun rejectsOtherMajorVersions() {
        val d = dispatcher()
        val r = d.handle("""{"v":"2.0","id":"x","cmd":"device.info","params":{}}""".toByteArray())
        assertEquals("version-mismatch", r.errorCode())
    }

    @Test
    fun negotiation() {
        val v10 = ProtocolVersion(1, 0)
        assertEquals(v10, negotiate(v10, ProtocolVersion(1, 5)))
        assertEquals(null, negotiate(ProtocolVersion(1, 1), ProtocolVersion(1, 5)))
        assertEquals(null, ProtocolVersion.parse("1"))
        assertEquals(null, ProtocolVersion.parse("01.0"))
        assertEquals(ProtocolVersion(1, 12), ProtocolVersion.parse("1.12"))
    }
}
