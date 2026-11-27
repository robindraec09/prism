/**
 * The subset of the host<->agent protocol (docs/design/protocol.md) that the P0-09 spike uses.
 * Full shared types belong in `@prismtest/core` (P0-03); these stay local until then.
 */

/** Protocol range this host speaks. */
export const HOST_PROTOCOL = { min: '1.0', max: '1.0' } as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Screen {
  width: number;
  height: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  orientation: string;
  insets?: { top: number; right: number; bottom: number; left: number };
}

/** Normalised UI node (protocol.md §2.2). */
export interface UiNode {
  id: string;
  role: string;
  name: string | null;
  text: string | null;
  value: string | null;
  hint?: string | null;
  testId: string | null;
  nativeType: string;
  bounds: Rect;
  visible: boolean;
  onScreen: boolean;
  enabled: boolean;
  focused: boolean;
  selected: boolean;
  checked: boolean | 'mixed' | null;
  expanded?: boolean | null;
  scrollable: boolean;
  password: boolean;
  webContent: boolean;
  context: string;
  children: UiNode[];
  raw?: Record<string, unknown>;
}

export interface Idle {
  settled: boolean;
  waitedMs: number;
  animating?: boolean;
}

export interface Snapshot {
  snapshotId: string;
  capturedAt: string;
  platform: string;
  screen: Screen;
  idle?: Idle;
  root: UiNode;
  nodeCount: number;
  truncated: boolean;
}

export interface HelloResult {
  protocol: { selected: string; min: string; max: string };
  agent: { name: string; version: string; platform: string; instanceId: string };
  capabilities: string[];
  device: {
    platform: string;
    osVersion: string;
    apiLevel?: number;
    model: string;
    emulator: boolean;
    screen: Screen;
    serial?: string;
    locale?: string;
    timeZone?: string;
  };
}

export interface ActionResult {
  at: { x: number; y: number };
  durationMs: number;
  idle?: Idle;
}

export interface Timing {
  startedAt: string;
  durationMs: number;
  implicitWaitMs?: number;
}

export interface ProtocolErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface CommandRequest {
  v: string;
  id: string;
  cmd: string;
  session?: string;
  params: Record<string, unknown>;
  timeoutMs?: number;
}

export type CommandResponse<T = unknown> =
  | { v: string; id: string; ok: true; result: T; timing: Timing }
  | { v: string; id: string; ok: false; error: ProtocolErrorBody; timing?: Timing };

/**
 * A protocol-level error answered by the agent (or synthesised by the host, such as
 * `agent-crashed`).
 *
 * @example
 * ```ts
 * try { await client.tap(1, 2); } catch (e) { if (e instanceof AgentError && e.retryable) retry(); }
 * ```
 */
export class AgentError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(body: ProtocolErrorBody) {
    super(`${body.code}: ${body.message}`);
    this.name = 'AgentError';
    this.code = body.code;
    this.retryable = body.retryable;
    this.details = body.details;
  }
}

/**
 * Builds a request envelope (protocol.md §6.1).
 *
 * @example
 * ```ts
 * buildRequest({ id: 'r-1', cmd: 'tree.get', session: 'k7q2xm4p.sess-1', params: {} });
 * // { v: '1.0', id: 'r-1', cmd: 'tree.get', session: 'k7q2xm4p.sess-1', params: {} }
 * ```
 */
export function buildRequest(opts: {
  id: string;
  cmd: string;
  params?: Record<string, unknown>;
  session?: string;
  v?: string;
  timeoutMs?: number;
}): CommandRequest {
  const req: CommandRequest = {
    v: opts.v ?? HOST_PROTOCOL.max,
    id: opts.id,
    cmd: opts.cmd,
    params: opts.params ?? {},
  };
  if (opts.session !== undefined) req.session = opts.session;
  if (opts.timeoutMs !== undefined) req.timeoutMs = opts.timeoutMs;
  return req;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validates a decoded response envelope against the request it answers and returns it typed.
 * Throws a plain `Error` for envelopes that break the protocol (a host or agent bug), never for
 * `ok: false` answers.
 *
 * @example
 * ```ts
 * const res = parseResponse(JSON.parse(body), 'r-1');
 * if (res.ok) console.log(res.result);
 * ```
 */
export function parseResponse<T = unknown>(body: unknown, expectedId: string): CommandResponse<T> {
  if (!isObject(body)) throw new Error('Agent response is not a JSON object');
  const { v, id, ok } = body;
  if (typeof v !== 'string' || !/^\d+\.\d+$/.test(v))
    throw new Error('Agent response has no valid "v"');
  if (id !== expectedId) {
    throw new Error(`Agent response id ${JSON.stringify(id)} does not match request ${expectedId}`);
  }
  if (ok === true) {
    if (!isObject(body['result'])) throw new Error('Agent response ok:true without "result"');
    if (!isObject(body['timing'])) throw new Error('Agent response without "timing"');
    return body as unknown as CommandResponse<T>;
  }
  if (ok === false) {
    const err = body['error'];
    if (
      !isObject(err) ||
      typeof err['code'] !== 'string' ||
      typeof err['message'] !== 'string' ||
      typeof err['retryable'] !== 'boolean'
    ) {
      throw new Error('Agent response ok:false without a valid "error"');
    }
    return body as unknown as CommandResponse<T>;
  }
  throw new Error('Agent response has no boolean "ok"');
}
