import type { Capability } from './capabilities.js';
import type { WireError } from './errors.js';
import type { Rect, Rotation } from './geometry.js';
import type { OpenString } from './open-string.js';
import type { ImageFormat } from './screenshot.js';
import type { DeviceInfo } from './driver.js';

/**
 * The host↔agent protocol version these types implement
 * (`docs/design/protocol.md`).
 *
 * @example
 * ```ts
 * import { PROTOCOL_VERSION } from '@prismtest/core';
 *
 * PROTOCOL_VERSION; // '1.0.0'
 * ```
 */
export const PROTOCOL_VERSION = '1.0.0';

/**
 * A `MAJOR.MINOR` protocol version, as negotiated in `hello` and sent as `v`.
 *
 * @example
 * ```ts
 * import type { ProtocolVersion } from '@prismtest/core';
 *
 * const v: ProtocolVersion = '1.0';
 * ```
 */
export type ProtocolVersion = `${number}.${number}`;

/**
 * A supported version range (wire type `ProtocolRange`).
 *
 * @example
 * ```ts
 * import type { ProtocolRange } from '@prismtest/core';
 *
 * const range: ProtocolRange = { min: '1.0', max: '1.0' };
 * ```
 */
export interface ProtocolRange {
  readonly min: ProtocolVersion;
  readonly max: ProtocolVersion;
}

/**
 * Identifies an on-device agent process (wire type `AgentInfo`).
 *
 * @example
 * ```ts
 * import type { AgentInfo } from '@prismtest/core';
 *
 * const agent: AgentInfo = {
 *   name: 'prism-android-agent', version: '0.1.0', platform: 'android', instanceId: 'k7q2xm4p',
 * };
 * ```
 */
export interface AgentInfo {
  readonly name: string;
  readonly version: string;
  readonly platform?: string;
  /** 8 lower-case base32 characters; changes when the agent restarts. */
  readonly instanceId: string;
}

/**
 * Agent-reported timing of one command (wire type `Timing`).
 *
 * @example
 * ```ts
 * import type { Timing } from '@prismtest/core';
 *
 * const t: Timing = { startedAt: '2026-11-27T10:15:05.110Z', durationMs: 71, implicitWaitMs: 0 };
 * ```
 */
export interface Timing {
  readonly startedAt: string;
  readonly durationMs: number;
  /** Time spent in waits the platform forced (protocol.md §9.1). */
  readonly implicitWaitMs?: number;
}

/**
 * A command request (protocol.md §6.1).
 *
 * @typeParam P - Shape of `params`.
 *
 * @example
 * ```ts
 * import type { WireRequest } from '@prismtest/core';
 *
 * const req: WireRequest = {
 *   v: '1.0', id: 'r-13', session: 'k7q2xm4p.sess-1', cmd: 'action.tap',
 *   params: { target: { node: { snapshotId: 'k7q2xm4p.s-4', nodeId: 'n5' } } },
 * };
 * ```
 */
export interface WireRequest<P extends object = Readonly<Record<string, unknown>>> {
  readonly v: ProtocolVersion;
  readonly id: string;
  readonly cmd: string;
  /** Required except for `hello`, `session.start` and `device.info`. */
  readonly session?: string;
  readonly params: P;
  readonly timeoutMs?: number;
}

/**
 * A successful response.
 *
 * @typeParam R - Shape of `result`.
 *
 * @example
 * ```ts
 * import type { WireSuccess } from '@prismtest/core';
 *
 * const res: WireSuccess<{ session: string }> = {
 *   v: '1.0', id: 'r-2', ok: true, result: { session: 'k7q2xm4p.sess-1' },
 *   timing: { startedAt: '2026-11-27T10:15:03.000Z', durationMs: 12 },
 * };
 * ```
 */
export interface WireSuccess<R> {
  readonly v: ProtocolVersion;
  readonly id: string;
  readonly ok: true;
  readonly result: R;
  readonly timing: Timing;
}

/**
 * A failed response. `timing` is absent only on host-synthesised
 * `agent-crashed` errors.
 *
 * @example
 * ```ts
 * import type { WireFailure } from '@prismtest/core';
 *
 * const res: WireFailure = {
 *   v: '1.0', id: 'r-21', ok: false,
 *   error: { code: 'element-not-found', message: 'No node matched …', retryable: true },
 *   timing: { startedAt: '2026-11-27T10:15:09.300Z', durationMs: 38 },
 * };
 * ```
 */
export interface WireFailure {
  readonly v: ProtocolVersion;
  readonly id: string;
  readonly ok: false;
  readonly error: WireError;
  readonly timing?: Timing;
}

/**
 * A command response (protocol.md §6.2), discriminated by `ok`.
 *
 * @typeParam R - Shape of `result` on success.
 *
 * @example
 * ```ts
 * import { PrismError, type WireResponse } from '@prismtest/core';
 *
 * function unwrap<R>(res: WireResponse<R>): R {
 *   if (!res.ok) throw PrismError.fromWire(res.error);
 *   return res.result;
 * }
 * ```
 */
export type WireResponse<R = Readonly<Record<string, unknown>>> = WireSuccess<R> | WireFailure;

/**
 * Event sources defined by protocol 1.0.
 *
 * @example
 * ```ts
 * import type { KnownEventSource } from '@prismtest/core';
 *
 * const s: KnownEventSource = 'agent';
 * ```
 */
export type KnownEventSource = 'agent' | 'host';

/**
 * An agent→host event frame (protocol.md §8).
 *
 * @typeParam D - Shape of `data`.
 *
 * @example
 * ```ts
 * import type { WireEvent } from '@prismtest/core';
 *
 * const ev: WireEvent<{ appId: string; kind: string }> = {
 *   v: '1.0', event: 'app.crashed', session: 'k7q2xm4p.sess-1', seq: 4,
 *   time: '2026-11-27T10:16:00.000Z', source: 'agent', data: { appId: 'com.example.shop', kind: 'crash' },
 * };
 * ```
 */
export interface WireEvent<D extends object = Readonly<Record<string, unknown>>> {
  readonly v: ProtocolVersion;
  readonly event: string;
  readonly session: string;
  /** Monotonic per session, starting at 1. */
  readonly seq: number;
  readonly time: string;
  readonly source: OpenString<KnownEventSource>;
  readonly data: D;
}

/**
 * Host→agent frame asking to replay events after a reconnect.
 *
 * @example
 * ```ts
 * import type { ResumeFrame } from '@prismtest/core';
 *
 * const f: ResumeFrame = { type: 'resume', session: 'k7q2xm4p.sess-1', afterSeq: 12 };
 * ```
 */
export interface ResumeFrame {
  readonly type: 'resume';
  readonly session: string;
  readonly afterSeq: number;
}

/**
 * Agent→host frame saying that requested events are no longer buffered.
 *
 * @example
 * ```ts
 * import type { GapFrame } from '@prismtest/core';
 *
 * const f: GapFrame = { type: 'gap', session: 'k7q2xm4p.sess-1', fromSeq: 13, toSeq: 40 };
 * ```
 */
export interface GapFrame {
  readonly type: 'gap';
  readonly session: string;
  readonly fromSeq: number;
  readonly toSeq: number;
}

/**
 * Parameters of `hello`.
 *
 * @example
 * ```ts
 * import type { HelloParams } from '@prismtest/core';
 *
 * const p: HelloParams = {
 *   client: { name: '@prismtest/android', version: '0.1.0' },
 *   protocol: { min: '1.0', max: '1.0' },
 *   want: ['find.agent'],
 * };
 * ```
 */
export interface HelloParams {
  readonly client: { readonly name: string; readonly version: string };
  readonly protocol: ProtocolRange;
  readonly want?: readonly Capability[];
}

/**
 * Result of `hello`.
 *
 * @example
 * ```ts
 * import type { HelloResult } from '@prismtest/core';
 *
 * const canFind = (r: HelloResult) => r.capabilities.includes('find.agent');
 * ```
 */
export interface HelloResult {
  readonly protocol: ProtocolRange & { readonly selected: ProtocolVersion };
  readonly agent: AgentInfo & { readonly platform: string };
  readonly capabilities: readonly Capability[];
  readonly device: DeviceInfo;
}

/**
 * Body of the unversioned `GET /version`.
 *
 * @example
 * ```ts
 * import type { VersionBody } from '@prismtest/core';
 *
 * const b: VersionBody = {
 *   protocol: { min: '1.0', max: '1.0' },
 *   agent: { name: 'prism-android-agent', version: '0.1.0', instanceId: 'k7q2xm4p' },
 * };
 * ```
 */
export interface VersionBody {
  readonly protocol: ProtocolRange;
  readonly agent: AgentInfo;
}

/**
 * Body of `GET /v1/health`.
 *
 * @example
 * ```ts
 * import type { HealthBody } from '@prismtest/core';
 *
 * const idle = (h: HealthBody) => h.running === null;
 * ```
 */
export interface HealthBody {
  readonly ok: boolean;
  readonly instanceId: string;
  readonly uptimeMs: number;
  readonly session: string | null;
  readonly running: { readonly id: string; readonly cmd: string; readonly forMs: number } | null;
}

/**
 * A screenshot in wire form: base64 `data` or an `artifactId`, never both.
 * Host drivers convert it to a {@link Screenshot} with decoded bytes.
 *
 * @example
 * ```ts
 * import type { WireScreenshot } from '@prismtest/core';
 *
 * const s: WireScreenshot = {
 *   format: 'png', width: 1080, height: 2400, scale: 3, rotation: 0,
 *   capturedAt: '2026-11-27T10:15:06.000Z', artifactId: 'a-7',
 * };
 * ```
 */
export type WireScreenshot = {
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly rotation: Rotation;
  readonly region?: Rect;
  readonly capturedAt: string;
} & (
  | { readonly data: string; readonly artifactId?: never }
  | { readonly artifactId: string; readonly data?: never }
);
