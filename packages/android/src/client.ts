import { Agent, request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import {
  AgentError,
  buildRequest,
  HOST_PROTOCOL,
  parseResponse,
  type ActionResult,
  type HelloResult,
  type Snapshot,
  type Timing,
} from './protocol.js';

/** Grace added to a command's `timeoutMs` before the host gives up (protocol.md §9.5). */
export const TRANSPORT_GRACE_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface AgentClientOptions {
  /** Host-side port that `adb forward` maps to the agent. */
  hostPort: number;
  /** Per-launch bearer token. Never logged. */
  token: string;
  /** Defaults to `127.0.0.1`. */
  host?: string;
}

/** Measurements of one HTTP exchange, for the P0-09 spike numbers. */
export interface CallStats {
  /** Host-measured round trip in ms (request write to full body read). */
  roundTripMs: number;
  /** Body bytes on the wire (compressed when the agent used gzip). */
  wireBytes: number;
  /** Decoded JSON bytes. */
  jsonBytes: number;
  /** `timing` reported by the agent. */
  timing?: Timing;
}

interface RawResponse {
  status: number;
  body: string;
  wireBytes: number;
  roundTripMs: number;
}

/**
 * HTTP client for one agent (protocol.md §4.1). Uses `node:http` with keep-alive and gzip, sends
 * the bearer token on every request and never sends an `Origin` header.
 *
 * @example
 * ```ts
 * const client = new AgentClient({ hostPort: 52817, token });
 * const hello = await client.hello();
 * const session = await client.sessionStart();
 * const tree = await client.treeGet();
 * await client.tap(180, 524);
 * ```
 */
export class AgentClient {
  private readonly opts: Required<AgentClientOptions>;
  private readonly agent = new Agent({ keepAlive: true, maxSockets: 2 });
  private nextId = 1;
  /** Selected protocol version after {@link hello}. */
  selectedVersion: string = HOST_PROTOCOL.max;
  /** Active session after {@link sessionStart}. */
  session: string | undefined;
  /** Stats of the last call. */
  lastStats: CallStats | undefined;

  constructor(opts: AgentClientOptions) {
    this.opts = { host: '127.0.0.1', ...opts };
  }

  close(): void {
    this.agent.destroy();
  }

  private raw(
    method: 'GET' | 'POST',
    path: string,
    body: string | undefined,
    timeoutMs: number,
  ): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.opts.token}`,
        'Accept-Encoding': 'gzip',
      };
      let payload: Buffer | undefined;
      if (body !== undefined) {
        payload = Buffer.from(body, 'utf8');
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(payload.length);
      }
      const req = request(
        {
          host: this.opts.host,
          port: this.opts.hostPort,
          method,
          path,
          headers,
          agent: this.agent,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', reject);
          res.on('end', () => {
            try {
              const wire = Buffer.concat(chunks);
              const decoded = res.headers['content-encoding'] === 'gzip' ? gunzipSync(wire) : wire;
              resolve({
                status: res.statusCode ?? 0,
                body: decoded.toString('utf8'),
                wireBytes: wire.length,
                roundTripMs: performance.now() - started,
              });
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          });
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`No answer from the agent within ${timeoutMs} ms`));
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.raw('GET', path, undefined, DEFAULT_TIMEOUT_MS);
    checkStatus(res.status, path);
    return JSON.parse(res.body) as T;
  }

  /** `GET /version` (unversioned). */
  version(): Promise<{
    protocol: { min: string; max: string };
    agent: { name: string; version: string; instanceId: string };
  }> {
    return this.getJson('/version');
  }

  /** `GET /v1/health`. */
  health(): Promise<{
    ok: boolean;
    instanceId: string;
    uptimeMs: number;
    session: string | null;
    running: { id: string; cmd: string; forMs: number } | null;
  }> {
    return this.getJson('/v1/health');
  }

  /**
   * Sends one command and returns its result. Throws {@link AgentError} for `ok: false` answers,
   * and an `agent-crashed` AgentError when the transport fails.
   */
  async command<T>(
    cmd: string,
    params: Record<string, unknown> = {},
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    const id = `r-${this.nextId++}`;
    const needsSession = !['hello', 'session.start', 'device.info'].includes(cmd);
    const req = buildRequest({
      id,
      cmd,
      params,
      v: this.selectedVersion,
      ...(needsSession && this.session !== undefined ? { session: this.session } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    const budget = (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) + TRANSPORT_GRACE_MS;
    let res: RawResponse;
    try {
      res = await this.raw('POST', '/v1/command', JSON.stringify(req), budget);
    } catch (e) {
      throw new AgentError({
        code: 'agent-crashed',
        message: `Agent did not answer ${cmd} (${e instanceof Error ? e.message : String(e)}). Check that the instrumentation is still running.`,
        retryable: true,
      });
    }
    checkStatus(res.status, '/v1/command');
    const parsed = parseResponse<T>(JSON.parse(res.body), id);
    this.lastStats = {
      roundTripMs: res.roundTripMs,
      wireBytes: res.wireBytes,
      jsonBytes: Buffer.byteLength(res.body, 'utf8'),
      ...(parsed.timing ? { timing: parsed.timing } : {}),
    };
    if (!parsed.ok) throw new AgentError(parsed.error);
    return parsed.result;
  }

  /** `hello`: negotiates the protocol version (protocol.md §5.1). */
  async hello(): Promise<HelloResult> {
    const result = await this.command<HelloResult>('hello', {
      client: { name: '@prismtest/android', version: '0.0.0' },
      protocol: { min: HOST_PROTOCOL.min, max: HOST_PROTOCOL.max },
      want: [],
    });
    this.selectedVersion = result.protocol.selected;
    return result;
  }

  async sessionStart(replace = false): Promise<string> {
    const { session } = await this.command<{ session: string }>(
      'session.start',
      replace ? { replace } : {},
    );
    this.session = session;
    return session;
  }

  async sessionStop(): Promise<void> {
    if (this.session === undefined) return;
    await this.command('session.stop');
    this.session = undefined;
  }

  treeGet(params: Record<string, unknown> = {}): Promise<Snapshot> {
    return this.command<Snapshot>('tree.get', params);
  }

  /** Taps a point in DIP. */
  tap(x: number, y: number, params: Record<string, unknown> = {}): Promise<ActionResult> {
    return this.command<ActionResult>('action.tap', { ...params, target: { point: { x, y } } });
  }
}

function checkStatus(status: number, path: string): void {
  if (status === 200) return;
  const why: Record<number, string> = {
    401: 'unauthorized: wrong or missing token; restart the agent with a new token',
    403: 'forbidden: the agent rejected the Host or Origin header',
    404: 'not found: the agent does not serve this path or protocol major version',
    413: 'request body too large',
  };
  throw new Error(
    `Agent answered HTTP ${status} for ${path} (${why[status] ?? 'transport error'})`,
  );
}
