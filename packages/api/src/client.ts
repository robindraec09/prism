import http from 'node:http';
import https from 'node:https';
import { inspect } from 'node:util';

import { serializeRequest } from './mask.js';
import type { HttpResponse } from './response.js';
import { createTransport } from './transport.js';
import type {
  HeaderInput,
  HttpClientOptions,
  HttpMethod,
  MetricsHook,
  Middleware,
  PreparedRequest,
  RedirectPolicy,
  RequestHandler,
  RequestOptions,
} from './types.js';
import { appendQuery, resolveUrl } from './url.js';

/**
 * The promise returned by every request method. Await it for the
 * {@link HttpResponse}, or call `.json()` / `.text()` on it directly.
 *
 * @example
 * ```ts
 * const order = await client.post('/orders', { json: { sku: 'TSHIRT-M' } }).json<{ id: string }>();
 * ```
 */
export interface ResponsePromise extends Promise<HttpResponse> {
  /** Waits for the response and parses its body as JSON. */
  json<T = unknown>(): Promise<T>;
  /** Waits for the response and decodes its body as text. */
  text(): Promise<string>;
}

/** Options for methods that usually carry no body. */
export type BodylessRequestOptions = Omit<RequestOptions, 'method'>;

/**
 * An HTTP client: one request pipeline (defaults, middleware, transport,
 * metrics hooks) shared by API tests and the load engine. Create one with
 * {@link createHttpClient}.
 *
 * @example
 * ```ts
 * const api = createHttpClient({ baseURL: 'http://localhost:3000' });
 * const res = await api.get('/health');
 * await api.close();
 * ```
 */
export interface HttpClient {
  /**
   * Sends a request with any method (default `GET`).
   *
   * @example
   * ```ts
   * await api.request('/items/1', { method: 'PURGE' });
   * ```
   */
  request(url: string | URL, options?: RequestOptions): ResponsePromise;
  /** Sends a `GET` request. @example `await api.get('/users', { query: { page: 2 } })` */
  get(url: string | URL, options?: BodylessRequestOptions): ResponsePromise;
  /** Sends a `HEAD` request. @example `await api.head('/files/a.zip')` */
  head(url: string | URL, options?: BodylessRequestOptions): ResponsePromise;
  /** Sends a `POST` request. @example `await api.post('/users', { json: { name: 'Ada' } })` */
  post(url: string | URL, options?: BodylessRequestOptions): ResponsePromise;
  /** Sends a `PUT` request. @example `await api.put('/users/1', { json: { name: 'Ada' } })` */
  put(url: string | URL, options?: BodylessRequestOptions): ResponsePromise;
  /** Sends a `PATCH` request. @example `await api.patch('/users/1', { json: { name: 'Ada' } })` */
  patch(url: string | URL, options?: BodylessRequestOptions): ResponsePromise;
  /** Sends a `DELETE` request. @example `await api.delete('/users/1')` */
  delete(url: string | URL, options?: BodylessRequestOptions): ResponsePromise;
  /** Sends an `OPTIONS` request. @example `await api.options('/users')` */
  options(url: string | URL, options?: BodylessRequestOptions): ResponsePromise;
  /**
   * Returns a new client with these options layered over this client's:
   * headers and tags are merged, middleware, metrics hooks and masked header
   * names are appended, other options replace. The new client shares this
   * client's connection pools.
   *
   * @example
   * ```ts
   * const admin = api.extend({ headers: { authorization: `Bearer ${token}` } });
   * ```
   */
  extend(options: HttpClientOptions): HttpClient;
  /**
   * Closes the connection pools this client created. Clients made with
   * {@link HttpClient.extend} share their parent's pools and close nothing.
   *
   * @example
   * ```ts
   * afterAll(() => api.close());
   * ```
   */
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_REDIRECTS = 20;
const EMPTY_TAGS: Readonly<Record<string, string>> = Object.freeze({});
const NO_HOOKS: readonly MetricsHook[] = Object.freeze([]);

/**
 * The prepared request the client hands to middleware. A class only so that
 * logging it masks secrets.
 */
class PreparedRequestImpl implements PreparedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: Buffer | undefined;
  timeout: number;
  redirect: RedirectPolicy;
  maxRedirects: number;
  signal: AbortSignal | undefined;
  name: string | undefined;
  tags: Readonly<Record<string, string>>;
  readonly #maskNames: ReadonlySet<string> | undefined;

  constructor(init: PreparedRequest, maskNames: ReadonlySet<string> | undefined) {
    this.method = init.method;
    this.url = init.url;
    this.headers = init.headers;
    this.body = init.body;
    this.timeout = init.timeout;
    this.redirect = init.redirect;
    this.maxRedirects = init.maxRedirects;
    this.signal = init.signal;
    this.name = init.name;
    this.tags = init.tags;
    this.#maskNames = maskNames;
  }

  toJSON(): unknown {
    return serializeRequest(this, this.#maskNames);
  }

  [inspect.custom](depth: number, options: object, inspectFn: typeof inspect): string {
    return `PreparedRequest ${inspectFn(this.toJSON(), { ...options, depth })}`;
  }
}

function mergeHeaders(target: Record<string, string>, input: HeaderInput | undefined): void {
  if (input === undefined) {
    return;
  }
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    if (value === undefined || value === null) {
      Reflect.deleteProperty(target, key);
    } else {
      target[key] = String(value);
    }
  }
}

function toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

function checkTimeout(value: number | undefined, where: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new RangeError(
      `${where} timeout must be a finite number of milliseconds >= 0 (0 disables it), but got ${String(value)}.`,
    );
  }
}

function toResponsePromise(promise: Promise<HttpResponse>): ResponsePromise {
  return Object.assign(promise, {
    json: <T>() => promise.then((res) => res.json<T>()),
    text: () => promise.then((res) => res.text()),
  });
}

/** Connection pools created by a root client, shared with clients made by `extend`. */
interface OwnedPools {
  http: http.Agent | undefined;
  https: https.Agent | undefined;
}

/** Agents passed by the user; never destroyed by Prism. */
type UserAgents = NonNullable<HttpClientOptions['agents']>;

function buildClient(
  options: HttpClientOptions,
  pools: OwnedPools,
  userAgents: UserAgents,
  owner: boolean,
): HttpClient {
  checkTimeout(options.timeout, 'createHttpClient()');
  const baseURL =
    options.baseURL === undefined ? undefined : resolveUrl(options.baseURL, undefined);
  const defaultHeaders: Record<string, string> = {};
  mergeHeaders(defaultHeaders, options.headers);
  const defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT;
  const defaultRedirect = options.redirect ?? 'follow';
  const defaultMaxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const defaultTags = options.tags ?? EMPTY_TAGS;
  const hooks = toArray(options.onMetrics);
  const maskNames =
    options.maskHeaders === undefined || options.maskHeaders.length === 0
      ? undefined
      : new Set(options.maskHeaders.map((name) => name.toLowerCase()));

  const transport = createTransport({
    hooks: hooks.length === 0 ? NO_HOOKS : hooks,
    maskNames,
    agentFor(protocol) {
      if (protocol === 'https:') {
        return userAgents.https ?? (pools.https ??= new https.Agent({ keepAlive: true }));
      }
      return userAgents.http ?? (pools.http ??= new http.Agent({ keepAlive: true }));
    },
  });

  // Compose the middleware once, not per request.
  let handler: RequestHandler = transport;
  const middleware: readonly Middleware[] = options.middleware ?? [];
  for (let i = middleware.length - 1; i >= 0; i--) {
    const step = middleware[i] as Middleware;
    const next = handler;
    handler = (req) => step(req, next);
  }

  function prepare(url: string | URL, opts: RequestOptions, method: string): PreparedRequestImpl {
    checkTimeout(opts.timeout, 'Request');
    if (opts.json !== undefined && opts.body !== undefined) {
      throw new TypeError(
        'A request cannot have both `json` and `body`. Use `json` for a value to serialise, or `body` for a string or bytes.',
      );
    }
    const target = resolveUrl(url, baseURL);
    if (opts.query !== undefined) {
      appendQuery(target, opts.query);
    }
    const headers = { ...defaultHeaders };
    mergeHeaders(headers, opts.headers);

    let body: Buffer | undefined;
    if (opts.json !== undefined) {
      const text = JSON.stringify(opts.json) as string | undefined;
      if (text === undefined) {
        throw new TypeError(
          'The `json` option could not be serialised (JSON.stringify returned undefined).',
        );
      }
      body = Buffer.from(text, 'utf8');
      headers['content-type'] ??= 'application/json';
    } else if (typeof opts.body === 'string') {
      body = Buffer.from(opts.body, 'utf8');
      headers['content-type'] ??= 'text/plain;charset=utf-8';
    } else if (opts.body !== undefined) {
      body = Buffer.isBuffer(opts.body)
        ? opts.body
        : Buffer.from(opts.body.buffer, opts.body.byteOffset, opts.body.byteLength);
      headers['content-type'] ??= 'application/octet-stream';
    }

    return new PreparedRequestImpl(
      {
        method: method.toUpperCase(),
        url: target,
        headers,
        body,
        timeout: opts.timeout ?? defaultTimeout,
        redirect: opts.redirect ?? defaultRedirect,
        maxRedirects: opts.maxRedirects ?? defaultMaxRedirects,
        signal: opts.signal,
        name: opts.name,
        tags: opts.tags === undefined ? defaultTags : { ...defaultTags, ...opts.tags },
      },
      maskNames,
    );
  }

  function send(
    url: string | URL,
    opts: RequestOptions | undefined,
    method: HttpMethod,
  ): ResponsePromise {
    let promise: Promise<HttpResponse>;
    try {
      promise = handler(prepare(url, opts ?? {}, method));
    } catch (err) {
      promise = Promise.reject(err as Error);
    }
    return toResponsePromise(promise);
  }

  return {
    request: (url, opts) => send(url, opts, opts?.method ?? 'GET'),
    get: (url, opts) => send(url, opts, 'GET'),
    head: (url, opts) => send(url, opts, 'HEAD'),
    post: (url, opts) => send(url, opts, 'POST'),
    put: (url, opts) => send(url, opts, 'PUT'),
    patch: (url, opts) => send(url, opts, 'PATCH'),
    delete: (url, opts) => send(url, opts, 'DELETE'),
    options: (url, opts) => send(url, opts, 'OPTIONS'),
    extend(more) {
      const headers: Record<string, string> = { ...defaultHeaders };
      mergeHeaders(headers, more.headers);
      const merged: HttpClientOptions = {
        ...options,
        ...more,
        headers,
        tags: { ...options.tags, ...more.tags },
        middleware: [...(options.middleware ?? []), ...(more.middleware ?? [])],
        onMetrics: [...hooks, ...toArray(more.onMetrics)],
        maskHeaders: [...(options.maskHeaders ?? []), ...(more.maskHeaders ?? [])],
      };
      return buildClient(merged, pools, { ...userAgents, ...more.agents }, false);
    },
    close() {
      if (owner) {
        pools.http?.destroy();
        pools.https?.destroy();
        pools.http = undefined;
        pools.https = undefined;
      }
      return Promise.resolve();
    },
  };
}

/**
 * Creates an HTTP client. Every request goes through one pipeline: client
 * defaults, then middleware (first one outermost), then the transport, which
 * sends the request over a keep-alive connection pool, follows redirects,
 * enforces the timeout and reports {@link RequestMetrics} to `onMetrics`
 * hooks. API tests and the load engine use the same pipeline.
 *
 * Built on Node's `node:http` and `node:https`; it has no dependencies.
 *
 * @param options - Client defaults. All optional.
 * @returns A new client. Call {@link HttpClient.close} when done so idle
 * keep-alive connections do not hold the process open.
 *
 * @example
 * ```ts
 * import { createHttpClient } from '@prismtest/api';
 *
 * const api = createHttpClient({
 *   baseURL: 'http://localhost:3000/api',
 *   headers: { authorization: `Bearer ${process.env.TOKEN}` },
 *   timeout: 5_000,
 * });
 *
 * const res = await api.post('/orders', { json: { sku: 'TSHIRT-M', qty: 2 } });
 * console.log(res.status, res.json(), res.timings.total);
 * await api.close();
 * ```
 */
export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  return buildClient(options, { http: undefined, https: undefined }, { ...options.agents }, true);
}
