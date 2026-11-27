#!/bin/sh
# P0-09: build the Android agent and the host package, then run the measurement harness against
# the connected emulator. Usage: packages/android/scripts/run-spike.sh [extra spike.js args]
set -eu
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT/packages/android-agent"
./gradlew :agent:testDebugUnitTest :agent:assembleDebug :agent:assembleDebugAndroidTest
cd "$ROOT"
pnpm --filter @prismtest/android build
OUT="$ROOT/packages/android-agent/agent/build/outputs/apk"
node packages/android/dist/spike.js \
  --agent-apk "$OUT/debug/agent-debug.apk" \
  --test-apk "$OUT/androidTest/debug/agent-debug-androidTest.apk" \
  --dump-tree tree.json --out p0-09-results.json "$@"
