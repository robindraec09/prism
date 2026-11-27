# @prismtest/android

Host side of the Prism Android driver (Node.js). Status: **P0-09 spike**. It contains:

- `src/adb.ts`: a dependency-free `adb` wrapper (`child_process`), command builders and output parsers.
- `src/launcher.ts`: installs and starts the on-device agent (`packages/android-agent`) with a per-launch token, waits for its ready line, runs `adb forward tcp:0 tcp:7100` and performs `hello`.
- `src/client.ts`: protocol client (`/version`, `/v1/health`, `hello`, `session.*`, `tree.get`, `action.tap`) on `node:http` with keep-alive and gzip.
- `src/spike.ts`: the P0-09 measurement harness.

The driver interface (P0-03) is not implemented yet.

## Run the spike on an emulator

Prerequisites: JDK 17 or 21, Android SDK with `platform-tools` and an emulator image of API 29 or later, `ANDROID_HOME` set, Node.js 22.12+, pnpm.

```sh
# 1. Boot an emulator (any API 29+ image), for example:
$ANDROID_HOME/emulator/emulator -avd Pixel_API_34 -no-snapshot-load &
adb wait-for-device

# 2. Build the agent APKs (from the repository root).
cd packages/android-agent
./gradlew :agent:testDebugUnitTest :agent:assembleDebug :agent:assembleDebugAndroidTest
cd ../..

# 3. Build this package.
pnpm install
pnpm --filter @prismtest/android build

# 4. Put a screen on the emulator, for example Settings.
adb shell am start -a android.settings.SETTINGS

# 5. Run the harness: installs both APKs, starts the agent, measures, stops it.
node packages/android/dist/spike.js \
  --agent-apk packages/android-agent/agent/build/outputs/apk/debug/agent-debug.apk \
  --test-apk packages/android-agent/agent/build/outputs/apk/androidTest/debug/agent-debug-androidTest.apk \
  --iterations 30 --dump-tree tree.json --out p0-09-results.json
```

`scripts/run-spike.sh` runs steps 2, 3 and 5. Add `--find-tap <testId>` to measure find + tap end to end. Pick a `testId` from `tree.json` whose tap does not change the screen (for example a static title). Add `--tap x,y` to measure bare taps at a point in DIP, and `--serial <serial>` when more than one device is attached.

## Start the agent by hand

```sh
TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
adb install -r -t packages/android-agent/agent/build/outputs/apk/debug/agent-debug.apk
adb install -r -t packages/android-agent/agent/build/outputs/apk/androidTest/debug/agent-debug-androidTest.apk
adb shell am instrument -w -e prismPort 7100 -e prismToken "$TOKEN" \
  io.prismtest.agent.test/androidx.test.runner.AndroidJUnitRunner &
# Wait for: PRISM_AGENT_READY port=7100 instance=<id> protocol=1.0.0
PORT=$(adb forward tcp:0 tcp:7100)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/version
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"v":"1.0","id":"r-1","cmd":"session.start","params":{}}' http://127.0.0.1:$PORT/v1/command
# Use the session from the answer:
curl -s --compressed -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"v":"1.0","id":"r-2","cmd":"tree.get","session":"<session>","params":{}}' http://127.0.0.1:$PORT/v1/command
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"v":"1.0","id":"r-3","cmd":"action.tap","session":"<session>","params":{"target":{"point":{"x":180,"y":400}}}}' \
  http://127.0.0.1:$PORT/v1/command
# Stop:
adb shell am force-stop io.prismtest.agent; adb forward --remove tcp:$PORT
```

The token shows up in your shell history and in `ps` on the host. That is fine for a manual check. Prism itself masks it in all logs (protocol.md §11.4).
