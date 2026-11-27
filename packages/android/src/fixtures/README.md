# Protocol fixtures

These responses were produced by the Kotlin agent's `Dispatcher` (packages/android-agent) running on the JVM against the fake login screen in `agent/src/test/kotlin/io/prismtest/agent/Fakes.kt` (the screen from protocol.md §12.2). Only `timing` was fixed so the files are stable. They were validated against `docs/design/protocol.schema.json`.

They are **not** recordings from a device. After the first emulator run (P0-09 "Needs a human"), replace or extend them with real responses (`node dist/spike.js --dump-tree tree.json`), keeping the request IDs the tests expect.
