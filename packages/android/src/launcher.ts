import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  AGENT_PACKAGE,
  buildInstrumentArgs,
  DEFAULT_DEVICE_PORT,
  maskSecrets,
  parseReadyLine,
  type Adb,
  type ReadyLine,
} from './adb.js';
import { AgentClient } from './client.js';
import type { HelloResult } from './protocol.js';

/**
 * Generates a per-launch agent token: 32 random bytes, base64url (protocol.md §11.2).
 *
 * @example
 * ```ts
 * const token = generateToken(); // 43 characters of [A-Za-z0-9_-]
 * ```
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Resolves with the ready line once it appears on `stream`, or rejects on timeout or when the
 * stream ends first (the instrumentation exited). Every line is passed to `onLine` already masked.
 *
 * @example
 * ```ts
 * const ready = await waitForReady(child.stdout, 30_000, [token]);
 * ```
 */
export function waitForReady(
  stream: Readable,
  timeoutMs: number,
  secrets: readonly string[] = [],
  onLine?: (line: string) => void,
): Promise<ReadyLine> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let seen = '';
    const cleanup = (): void => {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = maskSecrets(buffer.slice(0, nl).replace(/\r$/, ''), secrets);
        buffer = buffer.slice(nl + 1);
        seen = (seen + line + '\n').slice(-2000);
        onLine?.(line);
        const ready = parseReadyLine(line);
        if (ready) {
          cleanup();
          resolve(ready);
          return;
        }
      }
    };
    const onEnd = (): void => {
      cleanup();
      reject(
        new Error(
          `Agent instrumentation exited before it was ready. Output:\n${seen}${maskSecrets(buffer, secrets)}`,
        ),
      );
    };
    const onError = (e: Error): void => {
      cleanup();
      reject(e);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`Agent did not print PRISM_AGENT_READY within ${timeoutMs} ms. Output:\n${seen}`),
      );
    }, timeoutMs);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

export interface LaunchOptions {
  adb: Adb;
  /** Agent APK (`agent-debug.apk`). Installed when given together with `testApk`. */
  agentApk?: string;
  /** Instrumentation APK (`agent-debug-androidTest.apk`). */
  testApk?: string;
  devicePort?: number;
  /** Default 30 s (protocol.md §9.5). */
  readyTimeoutMs?: number;
  /** Receives masked instrumentation output and launcher progress. */
  log?: (line: string) => void;
}

export interface RunningAgent {
  client: AgentClient;
  hostPort: number;
  ready: ReadyLine;
  hello: HelloResult;
  /** Tears down: session, forward, agent process. Safe to call twice. */
  stop(): Promise<void>;
}

/**
 * Installs (optionally) and starts the agent, forwards its port and performs `hello`
 * (protocol.md §4.3).
 *
 * @example
 * ```ts
 * const agent = await launchAgent({ adb: new Adb(), agentApk, testApk });
 * await agent.client.sessionStart();
 * console.log((await agent.client.treeGet()).nodeCount);
 * await agent.stop();
 * ```
 */
export async function launchAgent(opts: LaunchOptions): Promise<RunningAgent> {
  const { adb } = opts;
  const log = opts.log ?? ((): void => undefined);
  const devicePort = opts.devicePort ?? DEFAULT_DEVICE_PORT;
  const token = generateToken();
  adb.addSecret(token);

  if (opts.agentApk && opts.testApk) {
    log(`installing ${opts.agentApk} and ${opts.testApk}`);
    await adb.install(opts.agentApk);
    await adb.install(opts.testApk);
  }
  // A previous agent would hold the device port.
  await adb.forceStop(AGENT_PACKAGE);

  const args = buildInstrumentArgs({ token, devicePort });
  log(maskSecrets(`adb ${adb.argsFor(args).join(' ')}`, [token]));
  const child = adb.spawn(args);
  child.stderr.on('data', (d: Buffer) => log(maskSecrets(d.toString().trimEnd(), [token])));

  let hostPort: number | undefined;
  let client: AgentClient | undefined;
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      await client?.sessionStop();
    } catch {
      // The agent may already be gone.
    }
    client?.close();
    if (hostPort !== undefined) await adb.removeForward(hostPort).catch(() => undefined);
    await adb.forceStop(AGENT_PACKAGE).catch(() => undefined);
    child.kill();
  };

  try {
    const ready = await waitForReady(child.stdout, opts.readyTimeoutMs ?? 30_000, [token], log);
    // Keep draining output so the pipe never fills up.
    child.stdout.on('data', (d: Buffer) => log(maskSecrets(d.toString().trimEnd(), [token])));
    hostPort = await adb.forward(ready.port);
    log(`agent ${ready.instanceId} ready on device port ${ready.port}, host port ${hostPort}`);
    client = new AgentClient({ hostPort, token });
    const hello = await client.hello();
    if (hello.agent.instanceId !== ready.instanceId) {
      throw new Error(
        `hello came from agent ${hello.agent.instanceId}, expected ${ready.instanceId}`,
      );
    }
    if (adb.serial !== undefined) hello.device.serial = adb.serial;
    return { client, hostPort, ready, hello, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
