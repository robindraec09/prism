# Prism Android agent (`io.prismtest.agent`)

On-device agent for the Prism Android driver: an instrumentation APK that serves the host<->agent protocol (`docs/design/protocol.md`) on `127.0.0.1:7100` of the device. Status: **P0-09 spike**. See `docs/design/android-agent.md` for what it does, what it does not do yet, and what still needs verifying on a device.

This is a Gradle project, not a pnpm package: the JavaScript tooling (pnpm, ESLint, Prettier, Vitest) ignores it.

## Layout

| Path | What |
| --- | --- |
| `agent/src/main/kotlin/io/prismtest/agent/` | The agent. Everything except `UiAutomationDevice.kt` is plain Kotlin (HTTP server, JSON, protocol, tree mapping) with no Android imports, so it runs in JVM unit tests |
| `agent/src/main/kotlin/.../UiAutomationDevice.kt` | The Android boundary: windows and nodes from `UiAutomation`, taps through `injectInputEvent` |
| `agent/src/androidTest/kotlin/.../PrismAgentEntry.kt` | The instrumentation entry point (one JUnit "test" that serves until stopped) |
| `agent/src/test/kotlin/` | JVM unit tests (JUnit 4) |

## Build and test

Needs JDK 17+ and the Android SDK (`ANDROID_HOME` or `local.properties` with `sdk.dir`).

```sh
./gradlew :agent:testDebugUnitTest          # JVM unit tests
./gradlew :agent:lintDebug                  # Android Lint (checks API levels against minSdk 29)
./gradlew :agent:assembleDebug :agent:assembleDebugAndroidTest
```

Outputs: `agent/build/outputs/apk/debug/agent-debug.apk` and `agent/build/outputs/apk/androidTest/debug/agent-debug-androidTest.apk`.

To start it on a device, see `packages/android/README.md`.

## Instrumentation arguments

| Argument | Default | Meaning |
| --- | --- | --- |
| `prismToken` | required, at least 32 characters | Bearer token every request must carry (protocol.md §11) |
| `prismPort` | `7100` | Loopback port to bind |
| `prismIdleTimeoutMs` | `1800000` (30 min) | Stop after this long without an authorised request |
