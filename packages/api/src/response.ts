import type { IncomingHttpHeaders } from 'node:http';
import { inspect } from 'node:util';

import { maskHeaders, maskUrl, serializeRequest } from './mask.js';
import type { HttpTimings, PreparedRequest, SerializedRequest } from './types.js';

/** @internal */
export interface HttpResponseInit {
  status: number;
  statusText: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
  url: URL;
  timings: HttpTimings;
  elapsed: number;
  redirects: readonly string[];
  request: PreparedRequest;
  maskNames: ReadonlySet<string> | undefined;
}

const JSON_SNIPPET_LENGTH = 200;

/**
 * A response with its body fully read. HTTP error statuses (4xx, 5xx) are
 * normal responses; check `status` or `ok`.
 *
 * `JSON.stringify` and `console.log` of a response mask secrets in the
 * request, URL and headers (`set-cookie` included) and leave the body out.
 *
 * @example
 * ```ts
 * const res = await client.get('/users/42');
 * res.status;                 // 200
 * res.header('content-type'); // 'application/json; charset=utf-8'
 * const user = res.json<{ id: number }>();
 * res.timings.total;          // milliseconds
 * ```
 */
export class HttpResponse {
  /** Status code, for example `200`. */
  readonly status: number;
  /** Reason phrase sent by the server, for example `"OK"`. */
  readonly statusText: string;
  /** The raw body bytes. */
  readonly body: Buffer;
  /** Final URL, after redirects. */
  readonly url: string;
  /** Phase timings of the final exchange (the last redirect hop). */
  readonly timings: HttpTimings;
  /** Milliseconds from the first exchange's start to the final body byte, redirects included. */
  readonly elapsed: number;
  /** URLs that answered with a redirect, in order. Empty when there was none. */
  readonly redirects: readonly string[];

  readonly #rawHeaders: IncomingHttpHeaders;
  #headers: Readonly<Record<string, string>> | undefined;
  readonly #request: PreparedRequest;
  readonly #maskNames: ReadonlySet<string> | undefined;

  /** @internal Responses are created by the HTTP client. */
  constructor(init: HttpResponseInit) {
    this.status = init.status;
    this.statusText = init.statusText;
    this.body = init.body;
    this.url = init.url.href;
    this.timings = init.timings;
    this.elapsed = init.elapsed;
    this.redirects = init.redirects;
    this.#rawHeaders = init.headers;
    this.#request = init.request;
    this.#maskNames = init.maskNames;
  }

  /** `true` for a 2xx status. */
  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  /**
   * Response headers with lower-case names. Repeated headers are joined with
   * `", "`; use {@link HttpResponse.getSetCookie} for `set-cookie`.
   */
  get headers(): Readonly<Record<string, string>> {
    if (this.#headers === undefined) {
      const out: Record<string, string> = {};
      for (const [name, value] of Object.entries(this.#rawHeaders)) {
        if (value !== undefined) {
          out[name] = typeof value === 'string' ? value : value.join(', ');
        }
      }
      this.#headers = Object.freeze(out);
    }
    return this.#headers;
  }

  /**
   * Returns one header by case-insensitive name, or `undefined`.
   *
   * @example
   * ```ts
   * res.header('Content-Type'); // 'application/json'
   * ```
   */
  header(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  /**
   * Returns each `set-cookie` header as its own string.
   *
   * @example
   * ```ts
   * res.getSetCookie(); // ['sid=abc; HttpOnly', 'theme=dark']
   * ```
   */
  getSetCookie(): string[] {
    const value = this.#rawHeaders['set-cookie'];
    return value === undefined ? [] : [...value];
  }

  /**
   * Decodes the body as text, using the `charset` from `content-type` when
   * it names one, otherwise UTF-8.
   *
   * @example
   * ```ts
   * (await client.get('/robots.txt')).text(); // 'User-agent: *\n...'
   * ```
   */
  text(): string {
    const charset = /;\s*charset="?([^";\s]+)/i.exec(this.#rawHeaders['content-type'] ?? '')?.[1];
    if (charset !== undefined && !/^utf-?8$/i.test(charset)) {
      try {
        return new TextDecoder(charset).decode(this.body);
      } catch {
        // Unknown charset label: fall back to UTF-8.
      }
    }
    return this.body.toString('utf8');
  }

  /**
   * Parses the body as JSON. Each call parses again, so callers may mutate
   * the result.
   *
   * @typeParam T - The expected shape. Not checked at run time; use schema
   * validation for that.
   * @throws {@link SyntaxError} If the body is not valid JSON. The message
   * names the request, status, content type and the start of the body.
   *
   * @example
   * ```ts
   * const order = (await client.post('/orders', { json: { qty: 2 } })).json<{ id: string }>();
   * ```
   */
  json<T = unknown>(): T {
    const text = this.text();
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      const snippet =
        text.length > JSON_SNIPPET_LENGTH ? `${text.slice(0, JSON_SNIPPET_LENGTH)}...` : text;
      throw new SyntaxError(
        `Response body of ${this.#request.method} ${maskUrl(this.url)} (status ${this.status}, ` +
          `content-type ${this.#rawHeaders['content-type'] ?? 'not set'}) is not valid JSON: ` +
          `${(cause as Error).message}. Body starts with: ${JSON.stringify(snippet)}`,
        { cause },
      );
    }
  }

  /** The request that produced this response, masked and without body. */
  get request(): SerializedRequest {
    return serializeRequest(this.#request, this.#maskNames);
  }

  /**
   * The masked form used by `JSON.stringify` and logs. The body is left out
   * (it may hold tokens); only its size is included.
   */
  toJSON(): Record<string, unknown> {
    return {
      status: this.status,
      statusText: this.statusText,
      url: maskUrl(this.url),
      headers: maskHeaders(this.#rawHeaders, this.#maskNames),
      redirects: this.redirects.map((url) => maskUrl(url)),
      timings: this.timings,
      elapsed: this.elapsed,
      request: this.request,
      bodyBytes: this.body.length,
    };
  }

  /** @internal Masks secrets in `console.log` and `util.inspect`. */
  [inspect.custom](depth: number, options: object, inspectFn: typeof inspect): string {
    return `HttpResponse ${inspectFn(this.toJSON(), { ...options, depth })}`;
  }
}
