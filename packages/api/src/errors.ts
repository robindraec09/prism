import type { SerializedRequest } from './types.js';

/**
 * Why a request failed without a usable response.
 *
 * - `TIMEOUT`: the request's `timeout` elapsed ({@link HttpTimeoutError}).
 * - `ABORTED`: the request's `signal` was aborted.
 * - `NETWORK`: DNS, connection or socket failure (refused, reset, ...).
 * - `TOO_MANY_REDIRECTS`: more than `maxRedirects` redirects.
 * - `REDIRECT_BLOCKED`: a redirect arrived with `redirect: 'error'`, or pointed to a non-HTTP URL.
 * - `INVALID_REQUEST`: Node refused to send the request (bad header value, bad method).
 *
 * @example
 * ```ts
 * if (err instanceof HttpRequestError && err.code === 'NETWORK') { ... }
 * ```
 */
export type HttpErrorCode =
  | 'TIMEOUT'
  | 'ABORTED'
  | 'NETWORK'
  | 'TOO_MANY_REDIRECTS'
  | 'REDIRECT_BLOCKED'
  | 'INVALID_REQUEST';

/**
 * Thrown (as a rejected promise) when a request produced no usable response.
 * HTTP error statuses such as 404 or 500 are responses, not errors: assert on
 * `res.status` instead. `request` is masked, so the error is safe to log.
 *
 * @example
 * ```ts
 * import { HttpRequestError } from '@prismtest/api';
 *
 * try {
 *   await client.get('http://127.0.0.1:1/');
 * } catch (err) {
 *   if (err instanceof HttpRequestError) console.log(err.code, err.request.url); // NETWORK ...
 * }
 * ```
 */
export class HttpRequestError extends Error {
  override name = 'HttpRequestError';
  /** Why the request failed. */
  readonly code: HttpErrorCode;
  /** The failed request, masked and without body. */
  readonly request: SerializedRequest;

  constructor(
    message: string,
    code: HttpErrorCode,
    request: SerializedRequest,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.code = code;
    this.request = request;
  }
}

/**
 * Where a timed-out request was when its time ran out.
 *
 * @example
 * ```ts
 * const phase: TimeoutPhase = 'response';
 * ```
 */
export type TimeoutPhase = 'queue' | 'connect' | 'send' | 'response' | 'body';

const PHASE_TEXT: Record<TimeoutPhase, string> = {
  queue: 'waiting for a free connection',
  connect: 'connecting',
  send: 'sending the request',
  response: 'waiting for the response headers',
  body: 'reading the response body',
};

/**
 * Thrown when a request exceeds its `timeout`. The message says which phase
 * was running and how to raise the limit.
 *
 * @example
 * ```ts
 * import { HttpTimeoutError } from '@prismtest/api';
 *
 * await expect(client.get('/slow', { timeout: 50 })).rejects.toThrow(HttpTimeoutError);
 * ```
 */
export class HttpTimeoutError extends HttpRequestError {
  override name = 'HttpTimeoutError';
  /** The limit that was exceeded, in milliseconds. */
  readonly timeout: number;
  /** What the request was doing when time ran out. */
  readonly phase: TimeoutPhase;

  constructor(request: SerializedRequest, timeout: number, phase: TimeoutPhase) {
    super(
      `${request.method} ${request.url} timed out after ${timeout} ms while ${PHASE_TEXT[phase]}. ` +
        'Raise `timeout` for this request, or in createHttpClient({ timeout }), if the server is expected to be this slow.',
      'TIMEOUT',
      request,
    );
    this.timeout = timeout;
    this.phase = phase;
  }
}
