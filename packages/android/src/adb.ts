import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';

/** Application ID of the agent APK (protocol.md §14 Q3). */
export const AGENT_PACKAGE = 'io.prismtest.agent';
/** Application ID of the instrumentation (test) APK. */
export const AGENT_TEST_PACKAGE = 'io.prismtest.agent.test';
/** Instrumentation runner (protocol.md §4.3). */
export const AGENT_RUNNER = 'androidx.test.runner.AndroidJUnitRunner';
/** Device-side port the agent binds on 127.0.0.1 (protocol.md §4.3, §14 Q3). */
export const DEFAULT_DEVICE_PORT = 7100;

/** One line of `adb devices -l`. */
export interface AdbDevice {
  serial: string;
  /** `device`, `offline`, `unauthorized`, ... */
  state: string;
  /** Extra `key:value` pairs such as `model` and `transport_id`. */
  props: Record<string, string>;
}

/** The ready line the agent prints once its server is bound (protocol.md §4.3). */
export interface ReadyLine {
  port: number;
  instanceId: string;
  protocol: string;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

/**
 * Builds the `adb shell` arguments that start the agent.
 *
 * The token is checked against the base64url alphabet because `adb shell` joins its arguments
 * into one device-side shell command line.
 *
 * @example
 * ```ts
 * buildInstrumentArgs({ token, devicePort: 7100 });
 * // ['shell', 'am', 'instrument', '-w', '-e', 'prismPort', '7100', '-e', 'prismToken', token,
 * //  'io.prismtest.agent.test/androidx.test.runner.AndroidJUnitRunner']
 * ```
 */
export function buildInstrumentArgs(opts: {
  token: string;
  devicePort?: number;
  idleTimeoutMs?: number;
}): string[] {
  const port = opts.devicePort ?? DEFAULT_DEVICE_PORT;
  if (!TOKEN_PATTERN.test(opts.token)) {
    throw new Error('Agent token must be at least 32 base64url characters');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid device port ${String(port)}`);
  }
  const args = ['shell', 'am', 'instrument', '-w', '-e', 'prismPort', String(port)];
  if (opts.idleTimeoutMs !== undefined) {
    if (!Number.isInteger(opts.idleTimeoutMs) || opts.idleTimeoutMs < 1) {
      throw new Error(`Invalid idle timeout ${String(opts.idleTimeoutMs)}`);
    }
    args.push('-e', 'prismIdleTimeoutMs', String(opts.idleTimeoutMs));
  }
  args.push('-e', 'prismToken', opts.token, `${AGENT_TEST_PACKAGE}/${AGENT_RUNNER}`);
  return args;
}

/**
 * Finds the agent's ready line in instrumentation output. Handles plain `am instrument -w` output
 * and the `-r` form (`INSTRUMENTATION_STATUS: stream=PRISM_AGENT_READY ...`).
 *
 * @example
 * ```ts
 * parseReadyLine('PRISM_AGENT_READY port=7100 instance=k7q2xm4p protocol=1.0.0');
 * // { port: 7100, instanceId: 'k7q2xm4p', protocol: '1.0.0' }
 * ```
 */
export function parseReadyLine(text: string): ReadyLine | undefined {
  const m = /PRISM_AGENT_READY port=(\d+) instance=([a-z2-7]{8}) protocol=(\d+\.\d+\.\d+)/.exec(
    text,
  );
  if (!m) return undefined;
  return { port: Number(m[1]), instanceId: m[2] ?? '', protocol: m[3] ?? '' };
}

/**
 * Parses `adb devices -l` output.
 *
 * @example
 * ```ts
 * parseDevices('List of devices attached\nemulator-5554 device product:sdk model:Pixel\n');
 * // [{ serial: 'emulator-5554', state: 'device', props: { product: 'sdk', model: 'Pixel' } }]
 * ```
 */
export function parseDevices(output: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue;
    const [serial, state, ...rest] = line.split(/\s+/);
    if (!serial || !state) continue;
    const props: Record<string, string> = {};
    for (const kv of rest) {
      const i = kv.indexOf(':');
      if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
    }
    devices.push({ serial, state, props });
  }
  return devices;
}

/**
 * Parses the host port printed by `adb forward tcp:0 tcp:<devicePort>`.
 *
 * @example
 * ```ts
 * parseForwardPort('52817\n'); // 52817
 * ```
 */
export function parseForwardPort(output: string): number {
  const m = /^\s*(\d{1,5})\s*$/.exec(output);
  const port = m ? Number(m[1]) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Unexpected output from adb forward: ${JSON.stringify(output.slice(0, 200))}`);
  }
  return port;
}

/**
 * Replaces every occurrence of each secret with `***` (protocol.md §11.4: the token appears in adb
 * command lines and must be masked in logs).
 *
 * @example
 * ```ts
 * maskSecrets('am instrument -e prismToken abc', ['abc']); // 'am instrument -e prismToken ***'
 * ```
 */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s) out = out.split(s).join('***');
  }
  return out;
}

/** Resolves the adb binary: `$ANDROID_HOME/platform-tools/adb` (or `ANDROID_SDK_ROOT`), else `adb` on PATH. */
export function resolveAdbPath(env: NodeJS.ProcessEnv = process.env): string {
  const sdk = env['ANDROID_HOME'] ?? env['ANDROID_SDK_ROOT'];
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  return sdk ? join(sdk, 'platform-tools', exe) : exe;
}

export interface AdbOptions {
  /** Path to the adb binary. Default: {@link resolveAdbPath}. */
  adbPath?: string;
  /** Device serial (`-s`). Required when more than one device is attached. */
  serial?: string;
  /** Secrets to mask in error messages. */
  secrets?: string[];
  /** Default timeout per adb call in ms. Default 60 000. */
  timeoutMs?: number;
}

/**
 * Minimal adb wrapper on `child_process` (no dependencies).
 *
 * @example
 * ```ts
 * const adb = new Adb({ serial: 'emulator-5554' });
 * const hostPort = await adb.forward(7100);
 * ```
 */
export class Adb {
  readonly adbPath: string;
  readonly serial: string | undefined;
  private readonly secrets: string[];
  private readonly timeoutMs: number;

  constructor(opts: AdbOptions = {}) {
    this.adbPath = opts.adbPath ?? resolveAdbPath();
    this.serial = opts.serial;
    this.secrets = opts.secrets ?? [];
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  /** Adds a secret to mask in errors from now on. */
  addSecret(secret: string): void {
    this.secrets.push(secret);
  }

  /** Full argument list including `-s <serial>`. */
  argsFor(args: readonly string[]): string[] {
    return this.serial ? ['-s', this.serial, ...args] : [...args];
  }

  /** Runs adb and resolves with stdout. Rejects with a masked message on failure. */
  run(args: readonly string[], timeoutMs = this.timeoutMs): Promise<string> {
    const full = this.argsFor(args);
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        full,
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            const cmd = maskSecrets(`adb ${full.join(' ')}`, this.secrets);
            const detail = maskSecrets(String(stderr || err.message).trim(), this.secrets);
            reject(new Error(`${cmd} failed: ${detail}`));
            return;
          }
          resolve(String(stdout));
        },
      );
    });
  }

  async devices(): Promise<AdbDevice[]> {
    return parseDevices(await this.run(['devices', '-l']));
  }

  /** `adb install -r -t <apk>` (replace, allow test APKs). */
  async install(apkPath: string): Promise<void> {
    const out = await this.run(['install', '-r', '-t', apkPath], 180_000);
    if (!/Success/.test(out))
      throw new Error(`adb install ${apkPath} did not report Success: ${out.trim()}`);
  }

  /** Lets adb pick a free host port forwarding to `tcp:<devicePort>`; returns the host port. */
  async forward(devicePort: number): Promise<number> {
    return parseForwardPort(await this.run(['forward', 'tcp:0', `tcp:${devicePort}`]));
  }

  async removeForward(hostPort: number): Promise<void> {
    await this.run(['forward', '--remove', `tcp:${hostPort}`]);
  }

  async shell(args: readonly string[]): Promise<string> {
    return this.run(['shell', ...args]);
  }

  async forceStop(pkg: string): Promise<void> {
    await this.shell(['am', 'force-stop', pkg]);
  }

  /** Starts a long-running adb process (used for `am instrument -w`). */
  spawn(args: readonly string[]): ChildProcessWithoutNullStreams {
    return spawn(this.adbPath, this.argsFor(args), { windowsHide: true });
  }
}
