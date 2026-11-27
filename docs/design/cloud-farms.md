# Cloud device farms: own agents or Appium/WebDriver adapter (P0-11)

Task: P0-11 (spike). Requirement: CLD-1, input to CLD-2 and CLD-3. Owner: `project-manager`.
Facts are **as of 2026-11-27**, taken from the provider pages listed under [Sources](#sources). Every row in the summary links to its evidence. Anything not stated on an opened page is marked **unverified**.

## 1. Question and short answer

The PRD decision says Prism uses **its own agents where a farm allows them** and a **WebDriver/Appium compatibility adapter as the fallback, on farms only**. The protocol (`protocol.md` §4.3, §4.4, §11) needs three things for an own-agent session:

1. installing and starting our instrumentation APK (`am instrument`) or XCTest runner (`xcodebuild test-without-building`) on the device;
2. a host→device path to the agent's loopback port: `adb forward` on Android, usbmux on iOS;
3. no remote agent binding and no outbound connections from the agent (§11.1, §11.7, resolved question Q12).

**Short answer.** No farm offers this on its **public, self-serve** plans. You get an own-agent session in one of two ways:

- **Remote device:** the farm bridges a real device to the user's machine as if it were plugged in over USB, giving local `adb` or usbmux. This is Enterprise or private-device only at BrowserStack, Sauce Labs, Kobiton, HeadSpin and Perfecto. It is pay-as-you-go but in preview at Google's Developer Device Platform.
- **Remote host:** the farm runs our Node host on a machine wired to the device. AWS Device Farm custom test environments do this, verified for Android.

Every farm in CLD-2 (BrowserStack, Sauce Labs, LambdaTest) needs the **Appium/WebDriver adapter** for ordinary accounts. **The adapter is therefore what CLD-2 actually needs. Own agents are an upgrade path, not the default.**

## 2. Verdict table

Legend: **Own agents feasible**: both protocol paths (install/start, plus `adb forward` or usbmux) are documented. **Partly feasible**: only on some plans, platforms or OS versions, or one link is unverified. **Adapter needed**: no documented host→device path, so use the Appium/WebDriver fallback.

| Provider / product | Android own agent | iOS own agent | Appium endpoint for fallback | Verdict | Evidence |
| --- | --- | --- | --- | --- | --- |
| **BrowserStack App Automate**, public devices | No. ADB limited to an allowlist through a custom executor; no `adb forward` | No | Yes (Appium, plus Espresso, XCUITest, Flutter, Detox on Android only, Maestro) | **Adapter needed** | [frameworks][bs-fw], [adb allowlist][bs-adb], [Maestro][bs-maestro] |
| **BrowserStack**, private devices (Custom Device Lab, Enterprise) | Yes. Device tunneling gives local `adb` and `adb forward` | Yes per docs (`iproxy`, macOS); iOS 17+ unverified | Yes. The tunnel is anchored to an App Automate Appium session | **Own agents partly feasible** (Enterprise only) | [device tunneling][bs-tunnel] |
| **BrowserStack App Live** (manual) | ADB shell tab, allowlisted commands only | No | n/a | Not an automation target | [App Live adb FAQ][bs-live-faq], [App Live adb][bs-live-adb] |
| **Sauce Labs Real Device Cloud**, public or self-serve | `adb shell` through `mobile:shell` only | No | Yes (Appium; Espresso and XCUITest through `saucectl`) | **Adapter needed** | [adb shell GA][sl-shell], [Espresso/XCUITest][sl-ex] |
| **Sauce Labs**, private devices (Enterprise: Real Device Access API / vUSB) | Yes. `access-api-connect` + `adb connect`; `adb forward` supported, `adb reverse` not | Partly. usbmuxd bridge (root, macOS or Linux); Xcode does not work on iOS 17+, libimobiledevice does | Yes, hosted or local Appium | **Own agents partly feasible** (Android yes; iOS ≤ 16 only via Xcode) | [connect ADB/Xcode][sl-connect], [Access API][sl-api], [vUSB][sl-vusb], [local Appium][sl-local] |
| **Sauce Labs** emulators and simulators | No ADB bridge documented (**unverified**) | No | Yes (Espresso on emulators; XCUITest on simulators in beta) | **Adapter needed** | [Espresso/XCUITest][sl-ex] |
| **LambdaTest**, now **TestMu AI** (incl. HyperExecute) | No. ADB through a `lambda-adb` executor allowlist; manual ADB shell tab (private devices add `am instrument`); no local `adb` or `adb forward` documented | No | Yes (Appium, Espresso, XCUITest, Flutter, Detox and Maestro on HyperExecute) | **Adapter needed**. Whether HyperExecute containers get ADB is **unverified** | [rebrand][lt-rebrand], [frameworks][lt-mobile], [adb executor][lt-adb], [ADB shell][lt-shell], [tunnel][lt-tunnel], [HyperExecute][lt-hyex] |
| **AWS Device Farm**, custom test environment | Yes. The test spec runs shell commands on an Amazon Linux host with `adb` to the device; Node 18–24 selectable; a Maestro (adb-driven) example exists | Partly. macOS host with Xcode and a generated `.xctestrun`; host→device port forwarding **unverified** | Yes. Appium 2/3 on the host, plus a managed Appium endpoint (Nov 2025) | **Own agents feasible on Android (remote host)**; iOS partly | [custom env][aws-custom], [software][aws-sw], [test spec][aws-spec], [env vars][aws-env], [Maestro blog][aws-maestro], [Appium endpoint][aws-appium] |
| **Firebase Test Lab** | Batch instrumentation only (`am instrument -e` args, custom runner class); no host link during the run | Batch XCTest only | No | **Neither**. Also **deprecated, shutting down 2027-09-30** | [overview][ftl-overview], [gcloud flags][ftl-gcloud], [XCTest][ftl-xctest], [migration][ftl-migrate] |
| **Google Developer Device Platform** (Test Lab successor, preview) | Yes. Device Streaming connects remote physical devices to local `adb` | Not yet ("coming soon") | No | **Own agents feasible on Android (remote device)**; preview, billing required | [overview][ddp-overview], [android device remote][ddp-cli], [migration FAQ][ftl-faq] |
| **Kobiton** | Yes per docs. virtualUSB exposes devices to local `adb` and Android Studio; `adb forward` not mentioned | Yes per docs. Xcode over virtualUSB; iOS 17.0–17.3 unsupported | Yes (Appium; vUSB and Appium sessions can combine) | **Own agents partly feasible**. Plan **unverified**; no video or device logs in vUSB sessions | [start debugging][kb-start], [set up][kb-setup] |
| **HeadSpin** | Yes. `hs connect` gives local `adb` (≥ 1.0.41) | Yes per docs (Xcode, XCTest); iOS 17 "full toolset" not available | Yes (**unverified** in detail) | **Own agents partly feasible**. Plan and pricing **unverified** | [remote debugging][hs-debug], [hs tunnel][hs-tunnel] |
| **TestingBot** | No ADB access documented | No | Yes (Appium, Espresso, XCUITest, Maestro; Mobilewright through Appium) | **Adapter needed**. Free open-source plan includes real devices | [app automate][tb-app], [open source][tb-oss], [Mobilewright][tb-mw] |
| **Perfecto** | Yes per docs. DevTunnel gives `adb`, opened from the manual testing view | Yes per docs (`idevice_id`, Xcode) | Yes (**unverified** in detail) | **Own agents partly feasible**. Use during automated sessions and licence **unverified** | [DevTunnel][pf-devtunnel], [connect][pf-connect] |

## 3. Per-provider notes

### 3.1 BrowserStack

- **Frameworks:** App Automate supports "Appium, Espresso, XCUITest, Flutter and Detox (only Android)" ([FAQ][bs-fw]), plus Maestro on Android and iOS through a build API ([Maestro][bs-maestro]). Mobilewright is in beta ([Mobilewright][bs-mw]).
- **Own instrumentation:** Espresso runs accept up to five custom `instrumentationOptions` key/value pairs ([custom Espresso options][bs-espresso]). That would carry our port and token, but the host has no path back to the agent on public devices.
- **ADB:** Appium runs without `relaxed-security`, so `mobile: shell` is unsupported. A `browserstack_executor` `adbShell` runs only allowlisted commands (`settings`, `dumpsys`, `getprop`, …). "Currently, we support only those adb commands that have been mentioned in this guide." ([adb commands][bs-adb]). App Live has its own allowlisted ADB shell ([App Live adb][bs-live-adb]).
- **Device tunneling (Enterprise, Custom Device Lab only):** "use native debugging tools as if the device were physically plugged in". Uses `adb forward` on Android and `iproxy` on iOS. The tunnel "is anchored to a BrowserStack App Automate session", started with the Appium capability `deviceTunnel: "true"` ([getting started][bs-tunnel]). Prism would therefore open a minimal Appium session to hold the device, then run its own agent over the tunnel. Whether Espresso/XCUITest sessions can anchor a tunnel, and whether `xcodebuild` works over it on iOS 17+, is **unverified**.
- **Local testing tunnel:** BrowserStack Local runs device→host (the device reaches the user's network). Using it for the agent would mean the agent dials out, which §11.7 forbids. Not used.
- **Status and artifacts (CLD-3):** REST `PUT /app-automate/sessions/{id}.json` sets `passed` or `failed` with a reason. `GET` returns `video_url`, `appium_logs_url` and `device_logs_url`, plus text, device, Appium and network (HAR) log endpoints ([sessions API][bs-sessions]).
- **Pricing for OSS:** A 2018 post offers open-source projects "free, unlimited access to all BrowserStack products … and App Automate", with 5 users/parallels ([blog][bs-oss]). Whether the programme still exists in 2026 is **unverified**. Applying needs a human.

### 3.2 Sauce Labs

- **Frameworks:** Appium; Espresso (real devices and emulators) and XCUITest (real devices; simulators beta) through `saucectl` ([Espresso/XCUITest][sl-ex]). `saucectl` `testOptions` pass arbitrary `am instrument -e` pairs, `suites[].timeout` sets the suite timeout, real devices cap tests at 90 minutes, and `sauce.tunnel` attaches Sauce Connect ([Espresso config][sl-espresso]).
- **ADB shell:** `mobile:shell` has been GA since 2024-04-30 ([changelog][sl-shell]). It is command execution, not a port path.
- **Real Device Access API (Enterprise only):** "direct access to Sauce Labs' real device cloud" over HTTP/WebSocket. It covers sessions, app install, ADB shell, HTTP proxying, a hosted Appium server, MJPEG video and log sockets. "The Access API is available on Enterprise plans only." ([intro][sl-api]).
  - **Android:** `access-api-connect <session>` then `adb connect localhost:7001`. `adb forward` works, `adb reverse` does not.
  - **iOS:** replaces `/var/run/usbmuxd` (root, macOS or Linux). Xcode works only up to iOS 16, because on iOS 17+ "this protocol is not carried over the usbmuxd tunnel". libimobiledevice works on all versions.
  - **Device type:** private devices only. Public devices return no `adbUrl`, `usbmuxdUrl` or `vusbUrl` ([connect][sl-connect]).
  - **HTTP forward:** a forward to `…/device/proxy/http/localhost/8100` exposes WDA for local Appium. Whether other device ports can be reached is **unverified** ([local Appium][sl-local]).
- **vUSB:** the same idea, Enterprise plus private devices, iOS 17 not supported. Its page was last updated 2025-05-26 ([vUSB][sl-vusb]).
- **Consequence for Prism:** Android own agents work on Enterprise private devices with the unchanged §4.3 flow. iOS own agents need a way to launch the XCTest runner without Xcode on iOS 17+ (for example the CoreDevice/`devicectl` path, or a provider XCUITest run plus HTTP forward). That is **unverified** and belongs with the P0-10 iOS spike.
- **Status and artifacts:** `saucectl` reports results in the Sauce UI ([Espresso/XCUITest][sl-ex]). How Access API sessions appear on the dashboard (video, pass/fail) is **unverified** beyond the live video and log sockets.
- **OSS plan:** "Open Sauce" could not be confirmed, because the old announcement URL now redirects to a generic page. **Unverified.**

### 3.3 LambdaTest (TestMu AI since 2026-01-12)

- LambdaTest "rebranded to TestMu AI on January 12, 2026". "All existing LambdaTest logins, scripts, capabilities, and integrations continue to work", with the "Same API endpoints" ([rebrand][lt-rebrand]). Appium still uses `mobile-hub.lambdatest.com/wd/hub` ([real devices][lt-real]).
- **Frameworks:** Appium, Espresso and XCUITest ([mobile][lt-mobile]). The docs index also lists Flutter, Detox on HyperExecute, and Espresso/XCUITest on HyperExecute ([docs index][lt-llms]). The HyperExecute pages themselves could not be opened (see [blocked pages](#blocked-pages)).
- **ADB:** `driver.execute_script("lambda-adb", …)` runs a fixed list of commands. Private devices add `pm`, `am`, `setprop`; `adb forward` is not listed ([ADB commands][lt-adb]). The manual ADB Shell tab is allowlisted, and private devices add `am instrument` ([ADB shell][lt-shell]). No local ADB bridge is documented.
- **Tunnel:** cloud→local only, for reaching internal apps ([tunnel][lt-tunnel]).
- **HyperExecute:** "connects to the server nearest the device pool, deploys one container per parallelization slot" ([blog][lt-hyex]). Whether those containers have ADB or usbmux to real devices (an AWS-style remote host) is **unverified** and the most promising open question for this provider.
- **Mobilewright driver (beta):** the farm runs a third-party, non-Appium TypeScript framework, "Nothing is installed on the device apart from your app" ([Mobilewright][lt-mw]).
- **OSS:** 10 parallel HyperExecute sessions for open-source projects (post updated 2025-04-17). Real devices are not mentioned and current status is **unverified** ([blog][lt-oss]).

### 3.4 AWS Device Farm

- **Custom mode is the recommended mode.** The YAML test spec "gets converted to a shell script which gets executed on the test host machine" ([custom env][aws-custom], [migration][aws-migrate]). Phases are `install`, `pre_test`, `test` and `post_test`, and a non-zero exit in `test` fails the run ([test spec][aws-spec]).
- **Hosts:** `amazon_linux_2023` / `amazon_linux_2` for Android, with Platform-Tools (`adb`) and `$ANDROID_HOME`. `macos_tahoe` / `macos_sequoia` for iOS, with Xcode 16–27. `devicefarm-cli use node 24|22|…` selects Node, and `npm` is included ([software][aws-sw], [env vars][aws-env]).
- **Android own agent: feasible.** The 2026-11-06 Maestro post installs a CLI on the host and runs `adb shell …`. The host has "ADB connectivity to the physical device under test", and the host reaches the internet or a VPC for downloads ([Maestro blog][aws-maestro]). Maestro works like Prism (host CLI plus on-device instrumentation server over ADB), so the §4.3 flow (`am instrument`, `adb forward`) should run unchanged. Prism ships the test project as the test package and runs `npx prism test` in the `test` phase. This is **remote-host mode**: the user's machine only uploads and collects.
- **iOS own agent: partly feasible, unverified.** The macOS host "dynamically connect[s] to iOS devices". `$DEVICEFARM_XCUITESTRUN_FILE` is generated from the uploaded app and test package ([iOS hosts][aws-ios], [XCUITest env][aws-xcui]). Shipping our runner as the XCUITest package looks possible. Whether the host can reach the runner's loopback port (usbmux/`iproxy`), and how Device Farm signs the runner, is not documented.
- **Fallback:** Appium 2/3 on the host ([software][aws-sw]). Since 2025-11-21 there is also a managed Appium endpoint for interactive runs from a local machine ([announcement][aws-appium]). Remote access sessions can "Connect to an Appium Endpoint"; ADB is not mentioned ([remote access][aws-remote]).
- **Limits:** a 150-minute hard limit per automated run and per remote session; 4-minute limit per Appium command; video and device logs capped at 1 GB each; custom-mode artifacts 1 GB cumulative; 4 GB per run ([limits][aws-limits]).
- **Artifacts and status (CLD-3):** files in `$DEVICEFARM_LOG_DIR` come back as "Customer Artifacts" through `ListArtifacts`. Custom mode live-streams client logs and video ([test spec][aws-spec], [custom env][aws-custom]). Pass/fail is the exit code of the `test` phase.
- **Pricing:** first 1,000 device minutes free (one-time), then $0.17 per device minute. Unmetered slots cost $250 per slot per month; private devices start at $200 per month ([pricing][aws-pricing]). No OSS programme found.

### 3.5 Firebase Test Lab and Google Developer Device Platform

- **Test Lab:** Android instrumentation, Robo and Game Loop; iOS XCTest ([overview][ftl-overview], [XCTest][ftl-xctest]). `--environment-variables` are passed as `am instrument -e` extras, `--test-runner-class` is allowed, and runs are limited to 45 min (physical) or 60 min (virtual) ([gcloud][ftl-gcloud]). Runs are batch-only with no host link, so Prism could only run a self-contained suite on the device, which the protocol does not support. The Spark plan gives 10 virtual and 5 physical runs per day; Blaze costs $5 per physical and $1 per virtual device hour ([pricing][ftl-pricing]). **Test Lab "will be fully shut down as of September 30, 2027"** ([migration][ftl-migrate]). **Do not target it.**
- **Developer Device Platform (preview):** includes "Device Streaming API: … remote physical and virtual Android devices, including ADB access". iOS is "coming soon", and a paid Google Cloud account is required ([overview][ddp-overview]). `android device remote create <codename>/<api>` "reserves physical Android devices … and connects them to adb on your machine" ([CLI][ddp-cli]). That is exactly the remote-device mode, with no Enterprise contract. Pricing matches Test Lab until 2027-04-30; there is no free tier ([FAQ][ftl-faq]).

### 3.6 Optional providers

- **Kobiton:** virtualUSB makes devices appear in Android Studio and Xcode. iOS 15–16 and 17.4+ are supported, 17.0–17.3 are not. "Video, device logs, and Session Explorer are not available for virtualUSB sessions" ([start debugging][kb-start]). Requires admin rights and runs on macOS 12+, Windows 10+ and Linux (CLI only) ([set up][kb-setup]).
- **HeadSpin:** `hs connect -t <token> SELECTOR` exposes devices to local `adb` and Xcode. iOS 17 lacks the full toolset ([remote debugging][hs-debug]). `hs tunnel` runs device→local network ([hs tunnel][hs-tunnel]). Devices can also be brought in as BYOD ([BYOD][hs-byod]).
- **TestingBot:** Appium, Espresso, XCUITest, Maestro, real devices plus emulators and simulators, EU datacentre, with a tunnel. No ADB access is documented ([app automate][tb-app]). The **free open-source plan** includes real devices and app automation, with no monthly cap and 2 parallel sessions. It requires a public repo with an OSI licence, non-commercial and active ([open source][tb-oss]). Its Mobilewright driver runs over Appium sessions on TestingBot's hub ([Mobilewright][tb-mw]), the same design as Prism's fallback.
- **Perfecto:** DevTunnel lets you use Perfecto devices "as if they were connected … over USB": `adb` (with `-s`) on Android, `idevice_id` / Xcode on iOS. It is opened from the Manual Testing view ([DevTunnel][pf-devtunnel], [connect][pf-connect]). Automated-session use and licensing are **unverified**.

## 4. What this means for Prism

### 4.1 Three integration modes

| Mode | How the agent is reached | Providers (as of this note) | Protocol impact |
| --- | --- | --- | --- |
| **A. Remote device** (own agents) | The farm's bridge gives the **local** host an `adb` serial or a usbmux device; Prism runs the unchanged §4.3/§4.4 flow (`am instrument`, `adb forward`, usbmux) | Google DDP (Android); Sauce Labs, BrowserStack (Enterprise private devices); Kobiton, HeadSpin, Perfecto (plans unverified) | None. The agent still binds `127.0.0.1` and the token is still required. Latency over the bridge is higher (§4.3) |
| **B. Remote host** (own agents) | Prism's Node host runs **on the farm's host** next to the device; the local CLI uploads the project and fetches results | AWS Device Farm custom environment (Android verified, iOS unverified); maybe HyperExecute (unverified) | None. The agent and host are co-located. Needs a "headless job" runner path and artifact export |
| **C. WebDriver fallback** (adapter) | Prism's `cloud-*` adapter speaks W3C WebDriver/Appium HTTP to the farm hub (UiAutomator2 / XCUITest drivers) | Every farm with Appium: BrowserStack, Sauce Labs, LambdaTest, TestingBot, AWS (managed endpoint), Kobiton, HeadSpin, Perfecto | Separate backend. Maps page-source XML to the normalised tree (§2, §3.5) and runs actionability checks host-side; lower fidelity and slower |

This confirms Q12. **None of the modes needs remote agent binding**, because every working own-agent path ends in `adb forward` or usbmux to the device's loopback. §11.8 can be closed as "not needed". Device→host tunnels (BrowserStack Local, Sauce Connect, LambdaTest tunnel, `hs tunnel`) would need the agent to dial out, against §11.7. Keep that rejected.

### 4.2 What the CLD-1 interface must support

1. **Capability discovery per provider, plan and device:** which modes (A/B/C) are available, platforms, OS versions, real or virtual, private or public. It must also be able to report "mode A available only on private devices" ahead of time, not fail at run time.
2. **Allocate / release:** device selection by name, OS version and ID, or by pool; region (Sauce US/EU, AWS region); queueing and wait timeouts; keep-alive or idle limits (Sauce sessions time out, AWS has a 150-minute hard limit).
3. **Upload:** app under test (`.apk`/`.aab`/`.ipa`). For mode A/B, also the Prism agent APK and test APK or the iOS runner (once per agent version, cached by hash). For mode B, the whole test project bundle.
4. **Connect, returning one of:** `{ kind: 'adb', serial }`, `{ kind: 'usbmux', udid, socketPath }`, `{ kind: 'webdriver', url, capabilities }`, or `{ kind: 'remote-host', jobId }`. The Android and iOS drivers then reuse their local code for the first two kinds. The bridge process (e.g. `access-api-connect`, `hs connect`, `android device remote`) is started and owned by the adapter.
5. **Run:** mode B submits a job (e.g. a Device Farm test spec that runs `npx prism test`) and streams logs. Modes A and C run in-process.
6. **Fetch artifacts:** provider video, device logs and Appium logs (BrowserStack `video_url`, AWS `ListArtifacts`). Prism's own trace and video too, because some bridges record nothing (Kobiton vUSB: no video or device logs).
7. **Report status (CLD-3):** pass/fail plus reason, per session (BrowserStack `PUT …/sessions/{id}.json`; AWS through the `test` phase exit code; Sauce `saucectl` results).
8. **Secrets:** provider usernames, access keys and tokens come from env or config and are masked in all logs and reports, like the agent token (§11.4). Bridges that need root or admin (Sauce iOS, Kobiton, BrowserStack) must be called out in `prism doctor`.

### 4.3 Recommendation

1. **Build mode C (WebDriver fallback) first for CLD-2.** It is the only path that works on all three named providers (BrowserStack, Sauce Labs, LambdaTest) without an Enterprise contract. Order: **BrowserStack → Sauce Labs → LambdaTest**. Use **TestingBot's free OSS plan** as the CI test bed, since it is the only verified free real-device programme. Apply to BrowserStack's OSS programme too (human action; current status unverified).
2. **Build mode A for Android next**, against **Google Developer Device Platform** (pay-as-you-go, no sales contact, plain `adb`). The same code then serves Sauce Labs and BrowserStack Enterprise private devices and Kobiton/HeadSpin/Perfecto, because they all end in a local `adb` serial. Only the bridge start/stop differs.
3. **Build mode B with AWS Device Farm (Android)** as the "own agents in CI at scale" option. It needs no tunnel, has 1,000 free trial minutes, and the Maestro precedent shows the pattern works.
4. **iOS own agents on farms: defer.** Every bridge has an iOS 17+ gap (Sauce: no Xcode over usbmux; HeadSpin: no full toolset; Kobiton: 17.0–17.3 unsupported). AWS iOS host→device forwarding is undocumented. Revisit after P0-10 proves how our runner is launched and reached on a real device. Until then iOS on farms uses mode C.
5. **Propose a PRD change (human decision):** CLD-2 should read "BrowserStack, Sauce Labs, LambdaTest via the WebDriver adapter; own agents on AWS Device Farm (remote host) and on Android remote-device bridges (Google DDP, Sauce/BrowserStack private devices)". Drop Firebase Test Lab from any future list (shutdown 2027-09-30).

### 4.4 Risks

| Risk | Impact | Response |
| --- | --- | --- |
| Own-agent paths are Enterprise/private-device only at the big three | Most users get mode C, so the fallback's fidelity defines the farm experience | Treat mode C as a first-class backend with its own tests; document the fidelity gaps (actionability checks, tree from page source) |
| iOS 17+ CoreDevice traffic is not carried by farm usbmux bridges | No iOS own agents on farms for current devices | Depends on P0-10; keep iOS on mode C |
| Latency over bridges | The §9.4 find+tap budget (local emulator) will not hold remotely | Measure in the CLD-1 spike; use `delivery: artifact` and gzip (§4.1); give remote timeouts their own defaults |
| Provider churn (LambdaTest rebrand, Firebase shutdown, preview DDP) | Adapters rot | One package per provider (`cloud-*`), contract tests against recorded responses, an "as of" date in docs |
| Terms of service for running custom instrumentation on shared devices | Account bans | Ask each provider before shipping mode A/B (open question 3) |
| No provider video in some bridge sessions (Kobiton vUSB) | CLD-3 gap | Prism records its own video (`screenrecord`) and attaches it to the report |
| Cost: no verified free tier except TestingBot OSS and AWS trial minutes | Maintainers cannot test every provider | Human decision on budget; mock adapters in CI, real runs before releases |

### 4.5 Open questions for the maintainers

1. Approve the CLD-2 change in §4.3 item 5 (PRD is human-only)?
2. Which accounts can we get? TestingBot OSS (verified eligibility), BrowserStack OSS (status unverified), AWS (trial minutes), Google Cloud billing for DDP. Any Enterprise contact at Sauce Labs or BrowserStack for private-device testing?
3. Should we ask BrowserStack, Sauce Labs and LambdaTest whether (a) custom instrumentation and XCTest bundles that open a loopback HTTP server are allowed, (b) a device tunnel can be anchored to an Espresso/XCUITest session instead of Appium (BrowserStack), (c) HyperExecute containers get ADB to real devices, and (d) the Sauce HTTP forward can reach ports other than 8100?
4. Do we want a "Prism on farm" partnership route like the Mobilewright drivers that BrowserStack, TestMu AI and TestingBot shipped in 2026? This is a later, non-engineering decision.
5. Confirm that §11.8 (opt-in remote binding) can be closed as "not needed" per §4.1 above.

## Sources

Pages opened for this note (2026-11-27):

**BrowserStack**

- `bs-fw`: <https://browserstack.com/support/faq/app-automate/basics-app-automate/what-test-automation-frameworks-are-supported-by-browserstack-app-automate>
- `bs-adb`: <https://www.browserstack.com/docs/app-automate/appium/advanced-features/adb-commands>
- `bs-maestro`: <https://www.browserstack.com/docs/app-automate/maestro/references/supported-commands>
- `bs-mw`: <https://www.browserstack.com/docs/app-automate/mobilewright/overview>
- `bs-espresso`: <https://browserstack.com/docs/app-automate/espresso/custom-espresso-options>
- `bs-tunnel`: <https://www.browserstack.com/docs/custom-device-lab/app-automate/appium/device-tunneling/getting-started>
- `bs-live-faq`: <https://browserstack.com/support/faq/app-live/features-app-live/does-browserstack-support-adb-commands-on-app-live-devices>
- `bs-live-adb`: <https://www.browserstack.com/docs/app-live/adb-commands>
- `bs-sessions`: <https://browserstack.com/docs/app-automate/api-reference/appium/sessions>
- `bs-oss`: <https://www.browserstack.com/blog/supporting-open-source-to-drive-community-innovation/>

**Sauce Labs**

- `sl-connect`: <https://docs.saucelabs.com/mobile-apps/real-device-access-api/connect-adb-and-xcode-to-remote-devices/>
- `sl-api`: <https://docs.saucelabs.com/mobile-apps/real-device-access-api/real-device-access-api-introduction/>
- `sl-local`: <https://docs.saucelabs.com/mobile-apps/real-device-access-api/real-device-access-api-local-appium/>
- `sl-vusb`: <https://docs.saucelabs.com/mobile-apps/features/virtual-usb/>
- `sl-shell`: <https://changelog.saucelabs.com/en/now-available-android-debug-bridge-adb-shell-support>
- `sl-ex`: <https://docs.saucelabs.com/mobile-apps/automated-testing/espresso-xcuitest>
- `sl-espresso`: <https://docs.saucelabs.com/mobile-apps/automated-testing/espresso-xcuitest/espresso/>
- <https://docs.saucelabs.com/dev/cli/espresso-xcuitest/>

**LambdaTest / TestMu AI**

- `lt-rebrand`: <https://www.testmuai.com/lambdatest-is-now-testmuai/>
- `lt-mobile`: <https://www.testmuai.com/intl/en-in/mobile-app-testing/>
- `lt-real`: <https://www.testmuai.com/support/docs/app-testing-on-real-devices/>
- `lt-llms`: <https://www.testmuai.com/support/docs/llms.txt>
- `lt-adb`: <https://www.testmuai.com/support/docs/adb-commands-support.md>
- `lt-shell`: <https://www.testmuai.com/support/docs/real-device-adb-shell.md>
- `lt-tunnel`: <https://www.testmuai.com/support/docs/testmu-tunnel.md>
- `lt-mw`: <https://www.testmuai.com/support/docs/mobilewright-overview/>
- `lt-hyex`: <https://www.testmuai.com/blog/accelerate-mobile-testing-with-hyperexecute-parallelization/>
- `lt-oss`: <https://www.testmuai.com/blog/lambdatest-loves-open-source/>

**AWS Device Farm**

- `aws-custom`: <https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environments.html>
- `aws-sw`: <https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environments-hosts-software.html>
- `aws-spec`: <https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environment-test-spec.html>
- `aws-env`: <https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environment-env-common.html>
- `aws-xcui`: <https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environment-test-types-xcode-ui-env.html>
- `aws-ios`: <https://docs.aws.amazon.com/ja_jp/devicefarm/latest/developerguide/custom-test-environments-hosts-ios.html>
- `aws-migrate`: <https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environment-migration.html>
- <https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environment-example.html>
- <https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environments-extending.html>
- <https://docs.aws.amazon.com/ja_jp/devicefarm/latest/developerguide/test-types-android-instrumentation.md>
- `aws-maestro`: <https://aws.amazon.com/blogs/devops/run-maestro-tests-on-real-android-devices-using-aws-device-farm/>
- `aws-appium`: <https://aws.amazon.com/about-aws/whats-new/2025/11/aws-device-farm-managed-appium-endpoint>
- `aws-remote`: <https://docs.aws.amazon.com/devicefarm/latest/developerguide/remote-access.html>
- `aws-limits`: <https://docs.aws.amazon.com/devicefarm/latest/developerguide/limits.html>
- `aws-pricing`: <https://aws.amazon.com/device-farm/pricing/>

**Firebase Test Lab / Google Developer Device Platform**

- `ftl-overview`: <https://firebase.google.com/docs/test-lab/overview>
- `ftl-gcloud`: <https://docs.cloud.google.com/sdk/gcloud/reference/beta/firebase/test/android/run>
- `ftl-xctest`: <https://firebase.google.com/docs/test-lab/ios/run-xctest>
- `ftl-pricing`: <https://firebase.google.com/docs/test-lab/usage-quotas-pricing>
- `ftl-migrate`: <https://firebase.google.com/docs/test-lab/migrate>
- `ftl-faq`: <https://firebase.google.com/docs/test-lab/migrate-faq>
- `ddp-overview`: <https://docs.cloud.google.com/developer-device-platform/overview>
- `ddp-cli`: <https://developer.android.com/tools/agents/android-cli/commands/device_remote>
- <https://docs.cloud.google.com/developer-device-platform/device-streaming>

**Kobiton, HeadSpin, TestingBot, Perfecto**

- `kb-start`: <https://docs.kobiton.com/debugging/start-debugging>
- `kb-setup`: <https://docs.kobiton.com/debugging/set-up-virtualusb>
- `hs-debug`: <https://headspin.io/docs/remote-debugging>
- `hs-tunnel`: <https://headspin.io/docs/hs-tunnel>
- `hs-byod`: <https://www.headspin.io/docs/byod>
- `tb-app`: <https://testingbot.com/support/app-automate>
- `tb-oss`: <https://testingbot.com/open-source>
- `tb-mw`: <https://testingbot.com/support/app-automate/mobilewright>
- `pf-devtunnel`: <https://help.perfecto.io/perfecto-help/content/perfecto/advanced/devtunnel___debug_on_real_perfecto_devices.htm>
- `pf-connect`: <https://help.perfecto.io/perfecto-help/content/perfecto/advanced/connect_to_a_perfecto_device_through_devtunnel.htm>

### Blocked pages

These pages could not be opened during research, so their content is **not** used above:

- https://www.browserstack.com/docs/private-devices/app-automate/appium/device-tunneling/getting-started (the custom-device-lab copy was used instead)
- <https://www.testmuai.com/support/docs/getting-started-with-espresso-testing/>
- <https://www.testmuai.com/support/docs/hyperexecute-espresso-testing.md>
- <https://www.testmuai.com/support/docs/hyperexecute-appium-testing.md>
- <https://www.testmuai.com/support/docs/app-testing-apis.md>
- <https://www.testmuai.com/support/docs/espresso-agent-skills/>
- https://saucelabs.com/resources/blog/announcing-open-sauce-free-unlimited-testing-for-open-source-projects (now redirects to a generic page)

[bs-fw]: https://browserstack.com/support/faq/app-automate/basics-app-automate/what-test-automation-frameworks-are-supported-by-browserstack-app-automate
[bs-adb]: https://www.browserstack.com/docs/app-automate/appium/advanced-features/adb-commands
[bs-maestro]: https://www.browserstack.com/docs/app-automate/maestro/references/supported-commands
[bs-mw]: https://www.browserstack.com/docs/app-automate/mobilewright/overview
[bs-espresso]: https://browserstack.com/docs/app-automate/espresso/custom-espresso-options
[bs-tunnel]: https://www.browserstack.com/docs/custom-device-lab/app-automate/appium/device-tunneling/getting-started
[bs-live-faq]: https://browserstack.com/support/faq/app-live/features-app-live/does-browserstack-support-adb-commands-on-app-live-devices
[bs-live-adb]: https://www.browserstack.com/docs/app-live/adb-commands
[bs-sessions]: https://browserstack.com/docs/app-automate/api-reference/appium/sessions
[bs-oss]: https://www.browserstack.com/blog/supporting-open-source-to-drive-community-innovation/
[sl-connect]: https://docs.saucelabs.com/mobile-apps/real-device-access-api/connect-adb-and-xcode-to-remote-devices/
[sl-api]: https://docs.saucelabs.com/mobile-apps/real-device-access-api/real-device-access-api-introduction/
[sl-local]: https://docs.saucelabs.com/mobile-apps/real-device-access-api/real-device-access-api-local-appium/
[sl-vusb]: https://docs.saucelabs.com/mobile-apps/features/virtual-usb/
[sl-shell]: https://changelog.saucelabs.com/en/now-available-android-debug-bridge-adb-shell-support
[sl-ex]: https://docs.saucelabs.com/mobile-apps/automated-testing/espresso-xcuitest
[sl-espresso]: https://docs.saucelabs.com/mobile-apps/automated-testing/espresso-xcuitest/espresso/
[lt-rebrand]: https://www.testmuai.com/lambdatest-is-now-testmuai/
[lt-mobile]: https://www.testmuai.com/intl/en-in/mobile-app-testing/
[lt-real]: https://www.testmuai.com/support/docs/app-testing-on-real-devices/
[lt-llms]: https://www.testmuai.com/support/docs/llms.txt
[lt-adb]: https://www.testmuai.com/support/docs/adb-commands-support.md
[lt-shell]: https://www.testmuai.com/support/docs/real-device-adb-shell.md
[lt-tunnel]: https://www.testmuai.com/support/docs/testmu-tunnel.md
[lt-mw]: https://www.testmuai.com/support/docs/mobilewright-overview/
[lt-hyex]: https://www.testmuai.com/blog/accelerate-mobile-testing-with-hyperexecute-parallelization/
[lt-oss]: https://www.testmuai.com/blog/lambdatest-loves-open-source/
[aws-custom]: https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environments.html
[aws-sw]: https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environments-hosts-software.html
[aws-spec]: https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environment-test-spec.html
[aws-env]: https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environment-env-common.html
[aws-xcui]: https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environment-test-types-xcode-ui-env.html
[aws-ios]: https://docs.aws.amazon.com/ja_jp/devicefarm/latest/developerguide/custom-test-environments-hosts-ios.html
[aws-migrate]: https://docs.aws.amazon.com/devicefarm/latest/developerguide/custom-test-environment-migration.html
[aws-maestro]: https://aws.amazon.com/blogs/devops/run-maestro-tests-on-real-android-devices-using-aws-device-farm/
[aws-appium]: https://aws.amazon.com/about-aws/whats-new/2025/11/aws-device-farm-managed-appium-endpoint
[aws-remote]: https://docs.aws.amazon.com/devicefarm/latest/developerguide/remote-access.html
[aws-limits]: https://docs.aws.amazon.com/devicefarm/latest/developerguide/limits.html
[aws-pricing]: https://aws.amazon.com/device-farm/pricing/
[ftl-overview]: https://firebase.google.com/docs/test-lab/overview
[ftl-gcloud]: https://docs.cloud.google.com/sdk/gcloud/reference/beta/firebase/test/android/run
[ftl-xctest]: https://firebase.google.com/docs/test-lab/ios/run-xctest
[ftl-pricing]: https://firebase.google.com/docs/test-lab/usage-quotas-pricing
[ftl-migrate]: https://firebase.google.com/docs/test-lab/migrate
[ftl-faq]: https://firebase.google.com/docs/test-lab/migrate-faq
[ddp-overview]: https://docs.cloud.google.com/developer-device-platform/overview
[ddp-cli]: https://developer.android.com/tools/agents/android-cli/commands/device_remote
[kb-start]: https://docs.kobiton.com/debugging/start-debugging
[kb-setup]: https://docs.kobiton.com/debugging/set-up-virtualusb
[hs-debug]: https://headspin.io/docs/remote-debugging
[hs-tunnel]: https://headspin.io/docs/hs-tunnel
[hs-byod]: https://www.headspin.io/docs/byod
[tb-app]: https://testingbot.com/support/app-automate
[tb-oss]: https://testingbot.com/open-source
[tb-mw]: https://testingbot.com/support/app-automate/mobilewright
[pf-devtunnel]: https://help.perfecto.io/perfecto-help/content/perfecto/advanced/devtunnel___debug_on_real_perfecto_devices.htm
[pf-connect]: https://help.perfecto.io/perfecto-help/content/perfecto/advanced/connect_to_a_perfecto_device_through_devtunnel.htm
