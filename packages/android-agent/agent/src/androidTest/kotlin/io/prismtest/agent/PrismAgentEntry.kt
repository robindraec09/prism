package io.prismtest.agent

import android.app.Instrumentation
import android.app.UiAutomation
import android.os.Bundle
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.Configurator
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Entry point. The host starts it with (protocol.md 4.3):
 *
 * ```
 * adb shell am instrument -w -e prismPort 7100 -e prismToken <token> \
 *   io.prismtest.agent.test/androidx.test.runner.AndroidJUnitRunner
 * ```
 *
 * The single "test" serves the protocol until the idle timeout (default 30 min, protocol.md 11.6)
 * or until the process is killed (`am force-stop io.prismtest.agent`).
 */
@RunWith(AndroidJUnit4::class)
class PrismAgentEntry {
    @Test
    fun serve() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        val token = args.getString("prismToken")
        require(token != null && token.length >= MIN_TOKEN_LENGTH) {
            "Missing or short instrumentation argument prismToken (need >= $MIN_TOKEN_LENGTH chars)"
        }
        val port = args.getString("prismPort")?.toIntOrNull() ?: ProtocolInfo.DEFAULT_PORT
        val idleTimeoutMs = args.getString("prismIdleTimeoutMs")?.toLongOrNull() ?: (30 * 60_000L)

        // protocol.md 9.1: no implicit UiAutomator waits. The agent does not use UiDevice today,
        // but anything that does (later commands) must inherit zero timeouts.
        Configurator.getInstance()
            .setWaitForIdleTimeout(0)
            .setActionAcknowledgmentTimeout(0)
            .setWaitForSelectorTimeout(0)
            .setScrollAcknowledgmentTimeout(0)
            .setUiAutomationFlags(UI_AUTOMATION_FLAGS)

        val uiAutomation = instrumentation.getUiAutomation(UI_AUTOMATION_FLAGS)
        val log = LogcatLog()
        val device = UiAutomationDevice(uiAutomation, instrumentation.context)
        val dispatcher = Dispatcher(device, log = log)
        val server = AgentServer(port, token, dispatcher, log, idleTimeoutMs)
        val boundPort = server.start()

        // The token is never logged or printed.
        val ready = "PRISM_AGENT_READY port=$boundPort instance=${dispatcher.instanceId} protocol=${ProtocolInfo.PROTOCOL_FULL}"
        log.info(ready)
        instrumentation.sendStatus(0, Bundle().apply { putString(Instrumentation.REPORT_KEY_STREAMRESULT, "$ready\n") })

        server.awaitStop()
        log.info("Prism agent stopped: ${server.stopReason}")
    }

    private class LogcatLog : AgentLog {
        override fun info(msg: String) {
            Log.i(TAG, msg)
        }

        override fun warn(msg: String, t: Throwable?) {
            Log.w(TAG, msg, t)
        }
    }

    private companion object {
        const val TAG = "PrismAgent"
        const val MIN_TOKEN_LENGTH = 32

        /** Keep TalkBack and other services running alongside the agent. */
        const val UI_AUTOMATION_FLAGS = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES
    }
}
