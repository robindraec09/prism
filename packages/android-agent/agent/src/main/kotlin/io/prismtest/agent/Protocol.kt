package io.prismtest.agent

import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Constants of the protocol version this agent implements (docs/design/protocol.md). */
object ProtocolInfo {
    const val AGENT_NAME = "prism-android-agent"
    const val AGENT_VERSION = "0.1.0"
    const val PROTOCOL_FULL = "1.0.0"
    val MIN = ProtocolVersion(1, 0)
    val MAX = ProtocolVersion(1, 0)
    const val DEFAULT_PORT = 7100

    /**
     * Capabilities this spike really implements. `idle.signal`: `settle` is honoured with
     * `UiAutomation.waitForIdle`. `idle.noImplicit`: no platform-forced waits. `state.focused`:
     * `AccessibilityNodeInfo.isFocused` is reliable.
     */
    val CAPABILITIES = listOf("idle.signal", "idle.noImplicit", "state.focused")
}

/** `MAJOR.MINOR` protocol version. */
data class ProtocolVersion(val major: Int, val minor: Int) : Comparable<ProtocolVersion> {
    override fun compareTo(other: ProtocolVersion): Int =
        if (major != other.major) major.compareTo(other.major) else minor.compareTo(other.minor)

    override fun toString() = "$major.$minor"

    companion object {
        private val PATTERN = Regex("^(0|[1-9][0-9]{0,3})\\.(0|[1-9][0-9]{0,3})$")

        fun parse(s: String?): ProtocolVersion? {
            val m = s?.let { PATTERN.matchEntire(it) } ?: return null
            return ProtocolVersion(m.groupValues[1].toInt(), m.groupValues[2].toInt())
        }
    }
}

/**
 * Picks the highest version both sides support (protocol.md 5.1), or null when the ranges do not
 * overlap.
 */
fun negotiate(
    hostMin: ProtocolVersion,
    hostMax: ProtocolVersion,
    agentMin: ProtocolVersion = ProtocolInfo.MIN,
    agentMax: ProtocolVersion = ProtocolInfo.MAX,
): ProtocolVersion? {
    val lo = maxOf(hostMin, agentMin)
    val hi = minOf(hostMax, agentMax)
    return if (lo <= hi) hi else null
}

/** A protocol-level error, answered as `{ ok: false, error }` with HTTP 200 (protocol.md 6.2). */
class ProtocolError(
    val code: String,
    message: String,
    val retryable: Boolean = false,
    val details: Map<String, Any?>? = null,
) : Exception(message) {
    fun toJson(): Map<String, Any?> {
        val m = linkedMapOf<String, Any?>("code" to code, "message" to message, "retryable" to retryable)
        if (details != null) m["details"] = details
        return m
    }

    companion object {
        fun invalid(param: String, message: String, allowed: List<Any?>? = null): ProtocolError {
            val d = linkedMapOf<String, Any?>("param" to param)
            if (allowed != null) d["allowed"] = allowed
            return ProtocolError("invalid-request", message, false, d)
        }

        fun unsupported(feature: String, message: String): ProtocolError =
            ProtocolError("unsupported", message, false, mapOf("feature" to feature))
    }
}

object Ids {
    private const val BASE32 = "abcdefghijklmnopqrstuvwxyz234567"
    private val random = SecureRandom()

    /** 8 random lower-case base32 characters (protocol.md 5.3). */
    fun newInstanceId(): String {
        val sb = StringBuilder(8)
        repeat(8) { sb.append(BASE32[random.nextInt(32)]) }
        return sb.toString()
    }

    private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    /** ISO 8601 UTC with milliseconds, e.g. `2026-11-27T10:15:02.114Z`. */
    fun timestamp(epochMs: Long): String = ISO.format(Instant.ofEpochMilli(epochMs))
}

/** Typed accessors over a decoded JSON object that raise `invalid-request` naming the parameter. */
class Params(private val map: Map<String, Any?>, private val prefix: String = "") {
    private fun name(key: String) = if (prefix.isEmpty()) key else "$prefix.$key"

    fun has(key: String) = map.containsKey(key) && map[key] != null

    fun obj(key: String): Params? = when (val v = map[key]) {
        null -> null
        is Map<*, *> -> {
            @Suppress("UNCHECKED_CAST")
            Params(v as Map<String, Any?>, name(key))
        }
        else -> throw ProtocolError.invalid(name(key), "Parameter '${name(key)}' must be an object.")
    }

    fun requireObj(key: String): Params =
        obj(key) ?: throw ProtocolError.invalid(name(key), "Missing required parameter '${name(key)}'.")

    fun string(key: String): String? = when (val v = map[key]) {
        null -> null
        is String -> v
        else -> throw ProtocolError.invalid(name(key), "Parameter '${name(key)}' must be a string.")
    }

    fun requireString(key: String): String =
        string(key) ?: throw ProtocolError.invalid(name(key), "Missing required parameter '${name(key)}'.")

    fun bool(key: String): Boolean? = when (val v = map[key]) {
        null -> null
        is Boolean -> v
        else -> throw ProtocolError.invalid(name(key), "Parameter '${name(key)}' must be a boolean.")
    }

    fun number(key: String): Double? = when (val v = map[key]) {
        null -> null
        is Number -> v.toDouble().also {
            if (it.isNaN() || it.isInfinite()) throw ProtocolError.invalid(name(key), "Parameter '${name(key)}' must be finite.")
        }
        else -> throw ProtocolError.invalid(name(key), "Parameter '${name(key)}' must be a number.")
    }

    fun requireNumber(key: String): Double =
        number(key) ?: throw ProtocolError.invalid(name(key), "Missing required parameter '${name(key)}'.")

    fun int(key: String, min: Long = Long.MIN_VALUE): Long? {
        val v = map[key] ?: return null
        val l = when (v) {
            is Long -> v
            is Int -> v.toLong()
            is Double -> if (v == Math.rint(v) && Math.abs(v) < 9e15) v.toLong() else null
            else -> null
        } ?: throw ProtocolError.invalid(name(key), "Parameter '${name(key)}' must be an integer.")
        if (l < min) throw ProtocolError.invalid(name(key), "Parameter '${name(key)}' must be >= $min.")
        return l
    }

    fun enum(key: String, allowed: List<String>): String? {
        val v = string(key) ?: return null
        if (v !in allowed) {
            throw ProtocolError.invalid(name(key), "Parameter '${name(key)}' is '$v'; allowed values: ${allowed.joinToString()}.", allowed)
        }
        return v
    }
}
