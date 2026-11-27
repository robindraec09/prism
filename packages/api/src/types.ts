import type { Agent as HttpAgent } from 'node:http';
import type { Agent as HttpsAgent } from 'node:https';

import type { HttpRequestError } from './errors.js';
import type { HttpResponse } from './response.js';

/**
 * An HTTP method. The common methods are listed for autocompletion; any other
 * valid method token (for example `PROPFIND`) is accepted too. Methods are
 * sent upper-cased.
 *
 * @example
 * ```ts
 * await client.request('/files/a.txt', { method: 'PROPFIND' });
 * ```
 */
export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | 'TRACE'
  | (string & Record<never, never>);

/**
 * What to do when the server answers with a redirect (301, 302, 303, 307, 308
 * with a `Location` header).
 *
 * - `follow` (default): follow up to `maxRedirects` redirects, like a browser.
 * - `manual`: return the redirect response as is.
 * - `error`: fail with an {@link HttpRequestError} whose code is `REDIRECT_BLOCKED`.
 *
 * @example
 * ```ts
 * const res = await client.get('/login', { redirect: 'manual' });
 * res.status; // 302
 * ```
 */
export type RedirectPolicy = 'follow' | 'manual' | 'error';

/**
 * Header values accepted in options. `undefined` and `null` remove a header,
 * for example one set in the client defaults. Names are case-insensitive.
 *
 * @example
 * ```ts
 * const headers: HeaderInput = { 'X-Trace': 'abc', 'X-Retry': 2, Accept: undefined };
 * ```
 */
export type HeaderInput = Readonly<Record<string, string | number | null | undefined>>;

/**
 * A single query parameter value. `null` and `undefined` skip the parameter;
 * arrays repeat it (`?tag=a&tag=b`).
 *
 * @example
 * ```ts
 * const value: QueryValue = ['a', 'b'];
 * ```
 */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

/**
 * Query parameters, appended to any query already in the URL.
 *
 * @example
 * ```ts
 * await client.get('/search', { query: { q: 'shoes', page: 2, tag: ['new', 'sale'] } });
 * // GET /search?q=shoes&page=2&tag=new&tag=sale
 * ```
 */
export type QueryParams = Readonly<Record<string, QueryValue>> | URLSearchParams;

/**
 * Options for one request. Every option except the body overrides the client
 * default of the same name.
 *
 * @example
 * ```ts
 * await client.post('/orders', {
 *   json: { sku: 'TSHIRT-M', qty: 2 },
 *   headers: { 'Idempotency-Key': 'abc' },
 *   timeout: 2_000,
 *   name: 'create order',
 * });
 * ```
 */
export interface RequestOptions {
  /** HTTP method. Defaults to `GET` for {@link HttpClient.request}. */
  method?: HttpMethod;
  /** Request headers, merged over the client's default headers. */
  headers?: HeaderInput;
  /** Query parameters appended to the URL. */
  query?: QueryParams;
  /**
   * A value serialised with `JSON.stringify`. Sets `content-type:
   * application/json` unless the request already has a content type. Cannot
   * be combined with `body`.
   */
  json?: unknown;
  /**
   * A raw body. A string is sent as UTF-8 with `content-type:
   * text/plain;charset=utf-8`, bytes with `application/octet-stream`, unless
   * the request already has a content type. Cannot be combined with `json`.
   */
  body?: string | Uint8Array;
  /**
   * Time limit in milliseconds for the whole request, redirects and reading
   * the body included. `0` disables the limit. Default: the client's
   * `timeout`, which defaults to 30 000.
   */
  timeout?: number;
  /** Redirect policy. Default: the client's, which defaults to `follow`. */
  redirect?: RedirectPolicy;
  /** Maximum redirects to follow. Default: the client's, which defaults to 20. */
  maxRedirects?: number;
  /** Aborts the request. The promise rejects with code `ABORTED`. */
  signal?: AbortSignal;
  /**
   * A stable name for this request in metrics and reports, for example
   * `"create order"`. Load tests group results by it (PERF-3).
   */
  name?: string;
  /** Free-form tags passed to metrics hooks, merged over the client's tags. */
  tags?: Readonly<Record<string, string>>;
}

/**
 * Options for {@link createHttpClient}.
 *
 * @example
 * ```ts
 * const client = createHttpClient({
 *   baseURL: 'http://localhost:3000/api',
 *   headers: { accept: 'application/json' },
 *   timeout: 5_000,
 *   middleware: [logRequests],
 *   onMetrics: (m) => histogram.record(m.timings.total),
 * });
 * ```
 */
export interface HttpClientOptions {
  /**
   * Prefix for relative request URLs. Paths are appended to it, so
   * `baseURL: 'http://h/api'` with `get('/users')` requests
   * `http://h/api/users`. Absolute request URLs ignore it.
   */
  baseURL?: string | URL;
  /** Headers sent with every request. */
  headers?: HeaderInput;
  /** Default time limit per request in milliseconds; `0` disables it. Default 30 000. */
  timeout?: number;
  /** Default redirect policy. Default `follow`. */
  redirect?: RedirectPolicy;
  /** Default maximum redirects to follow. Default 20. */
  maxRedirects?: number;
  /** Middleware run around every request, first one outermost. */
  middleware?: readonly Middleware[];
  /** Called after every network exchange (each redirect hop and each failure). */
  onMetrics?: MetricsHook | readonly MetricsHook[];
  /** Tags passed to metrics hooks for every request. */
  tags?: Readonly<Record<string, string>>;
  /**
   * Extra header names to mask in logs, errors and serialised requests, on
   * top of the built-in list (see {@link maskHeaders}).
   */
  maskHeaders?: readonly string[];
  /**
   * Connection pools to use. By default each client creates keep-alive agents
   * on first use and destroys them on {@link HttpClient.close}. Agents you
   * pass here are never destroyed by the client.
   */
  agents?: { http?: HttpAgent; https?: HttpsAgent };
}

/**
 * A request after defaults, base URL, query and body have been applied: what
 * middleware sees and may change before calling `next`. Headers have
 * lower-case names. `JSON.stringify` and `console.log` of the object built by
 * the client mask secrets; copies you make yourself do not.
 *
 * @example
 * ```ts
 * const addTrace: Middleware = (req, next) => {
 *   req.headers['x-trace-id'] = crypto.randomUUID();
 *   return next(req);
 * };
 * ```
 */
export interface PreparedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  /** Encoded body. `content-length` is set from it when the request is sent. */
  body: Buffer | undefined;
  /** Time limit in milliseconds; `0` means none. */
  timeout: number;
  redirect: RedirectPolicy;
  maxRedirects: number;
  signal: AbortSignal | undefined;
  name: string | undefined;
  tags: Readonly<Record<string, string>>;
}

/**
 * Sends a prepared request through the rest of the pipeline.
 *
 * @example
 * ```ts
 * const next: RequestHandler = (req) => client.request(req.url);
 * ```
 */
export type RequestHandler = (request: PreparedRequest) => Promise<HttpResponse>;

/**
 * A step in the request pipeline. It receives the prepared request and `next`,
 * and returns the response. It can change the request, call `next` more than
 * once (retries), or change or replace the response. Auth, retries and
 * logging are built as middleware.
 *
 * @example
 * ```ts
 * const retryOn503: Middleware = async (req, next) => {
 *   const res = await next(req);
 *   return res.status === 503 ? next(req) : res;
 * };
 * const client = createHttpClient({ middleware: [retryOn503] });
 * ```
 */
export type Middleware = (request: PreparedRequest, next: RequestHandler) => Promise<HttpResponse>;

/**
 * Phase durations of one network exchange, in milliseconds, measured with
 * `performance.now()`. Phases that did not happen are `0`: `dns`, `connect`
 * and `tls` are `0` on a reused keep-alive connection, `dns` is `0` for an IP
 * address, `tls` is `0` for plain HTTP.
 *
 * @example
 * ```ts
 * const { ttfb, total } = (await client.get('/health')).timings;
 * ```
 */
export interface HttpTimings {
  /** Waiting for a connection from the pool. */
  queued: number;
  /** DNS lookup. */
  dns: number;
  /** TCP connect. */
  connect: number;
  /** TLS handshake. */
  tls: number;
  /** Writing the request. */
  send: number;
  /** From the request being written to the first response byte (server time). */
  wait: number;
  /** Reading the response body. */
  receive: number;
  /** Time to first byte: from the start of the exchange to the response headers. */
  ttfb: number;
  /** The whole exchange, from start to the last body byte. */
  total: number;
}

/**
 * What a metrics hook receives after each network exchange. A request that
 * follows redirects produces one record per hop; a failed exchange produces a
 * record with `error` set and `status` undefined.
 *
 * @example
 * ```ts
 * const onMetrics: MetricsHook = (m) => {
 *   if (m.error) errors.add(1);
 *   else latency.add(m.timings.total, { name: m.name ?? m.method });
 * };
 * ```
 */
export interface RequestMetrics {
  /** The request's `name` option, if any. */
  name: string | undefined;
  method: string;
  /** Request URL with secrets masked. */
  url: string;
  /** Response status, or `undefined` when the exchange failed. */
  status: number | undefined;
  /** The failure, when the exchange failed. */
  error: HttpRequestError | undefined;
  /** `true` when this response is a redirect that the engine is following. */
  redirect: boolean;
  /** Wall-clock start of the exchange in epoch milliseconds (fractional). */
  startTime: number;
  timings: HttpTimings;
  /** Bytes written to the socket for this exchange (HTTP/1.1, before TLS). */
  bytesSent: number;
  /** Bytes read from the socket for this exchange (HTTP/1.1, after TLS). */
  bytesReceived: number;
  /** `true` when a keep-alive connection was reused. */
  socketReused: boolean;
  tags: Readonly<Record<string, string>>;
}

/**
 * Receives {@link RequestMetrics} synchronously after every exchange. Keep it
 * cheap (record into a histogram, do no I/O). A hook that throws does not
 * fail the request; the error is reported as a process warning.
 *
 * @example
 * ```ts
 * const client = createHttpClient({ onMetrics: (m) => samples.push(m.timings.total) });
 * ```
 */
export type MetricsHook = (metrics: RequestMetrics) => void;

/**
 * A request as written to logs, errors and reports: secrets in headers and the
 * URL are masked and the body is left out.
 *
 * @example
 * ```ts
 * JSON.stringify(res.request);
 * // {"method":"GET","url":"http://h/me","headers":{"authorization":"Bearer ***"}}
 * ```
 */
export interface SerializedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  name?: string;
}
