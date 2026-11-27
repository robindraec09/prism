import type { SerializedRequest } from './types.js';

/** The text that replaces a secret. */
export const MASK = '***';

const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-amz-security-token',
]);

// Header names and query keys that look like they carry a secret.
const SENSITIVE_NAME = /token|secret|passw(?:or)?d|api[-_]?key|session|signature|credential/i;

// Authorization schemes are kept so logs still show how a request authenticated.
const AUTH_SCHEME = /^([A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*)\s+\S/;

function isSensitiveHeader(name: string, extra: ReadonlySet<string> | undefined): boolean {
  return SENSITIVE_HEADERS.has(name) || extra?.has(name) === true || SENSITIVE_NAME.test(name);
}

function maskValue(name: string, value: string): string {
  if (name === 'authorization' || name === 'proxy-authorization') {
    const scheme = AUTH_SCHEME.exec(value);
    if (scheme) {
      return `${scheme[1]} ${MASK}`;
    }
  }
  return MASK;
}

/**
 * Returns a copy of `headers` with secrets replaced by `***`. Header names are
 * lower-cased. Masked: `authorization` and `proxy-authorization` (the scheme
 * such as `Bearer` is kept), `cookie`, `set-cookie`, common API-key and token
 * headers, any name containing `token`, `secret`, `password`, `api-key`,
 * `session`, `signature` or `credential`, and any name in `extra`.
 *
 * @param headers - Headers to mask.
 * @param extra - More lower-case header names to mask.
 * @returns A new object; `headers` is not changed.
 *
 * @example
 * ```ts
 * import { maskHeaders } from '@prismtest/api';
 *
 * maskHeaders({ Authorization: 'Bearer eyJhbGci...', Accept: 'application/json' });
 * // { authorization: 'Bearer ***', accept: 'application/json' }
 * ```
 */
export function maskHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  extra?: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (rawValue === undefined) {
      continue;
    }
    const name = rawName.toLowerCase();
    const value = typeof rawValue === 'string' ? rawValue : rawValue.join(', ');
    out[name] = isSensitiveHeader(name, extra) ? maskValue(name, value) : value;
  }
  return out;
}

/**
 * Returns `url` as a string with secrets replaced by `***`: the password in
 * `user:password@` and the values of query parameters whose names look
 * secret (`token`, `api_key`, `access_token`, `password`, `signature`, ...).
 *
 * @param url - The URL to mask.
 * @returns The masked URL.
 *
 * @example
 * ```ts
 * import { maskUrl } from '@prismtest/api';
 *
 * maskUrl('https://bob:hunter2@api.test/v1?api_key=abc&page=2');
 * // 'https://bob:***@api.test/v1?api_key=***&page=2'
 * ```
 */
export function maskUrl(url: string | URL): string {
  const parsed = typeof url === 'string' ? new URL(url) : url;
  if (parsed.password === '' && parsed.search === '') {
    return parsed.href;
  }
  let sensitiveQuery = false;
  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_NAME.test(key)) {
      sensitiveQuery = true;
      break;
    }
  }
  if (parsed.password === '' && !sensitiveQuery) {
    return parsed.href;
  }
  const copy = new URL(parsed.href);
  if (copy.password !== '') {
    copy.password = MASK;
  }
  if (sensitiveQuery) {
    const params = new URLSearchParams();
    for (const [key, value] of copy.searchParams) {
      params.append(key, SENSITIVE_NAME.test(key) ? MASK : value);
    }
    copy.search = params.toString();
  }
  // Keep the mask readable if a URL serialiser percent-encodes "*".
  return copy.href.replaceAll('%2A%2A%2A', MASK);
}

/**
 * Returns the masked, body-free form of a request used in logs, errors and
 * reports. Use it in logging middleware.
 *
 * @param request - The request to serialise.
 * @param extra - More lower-case header names to mask.
 * @returns The serialised request.
 *
 * @example
 * ```ts
 * import { createHttpClient, serializeRequest, type Middleware } from '@prismtest/api';
 *
 * const log: Middleware = (req, next) => {
 *   console.log(JSON.stringify(serializeRequest(req)));
 *   return next(req);
 * };
 * ```
 */
export function serializeRequest(
  request: {
    readonly method: string;
    readonly url: URL;
    readonly headers: Readonly<Record<string, string>>;
    readonly name?: string | undefined;
  },
  extra?: ReadonlySet<string>,
): SerializedRequest {
  const out: SerializedRequest = {
    method: request.method,
    url: maskUrl(request.url),
    headers: maskHeaders(request.headers, extra),
  };
  if (request.name !== undefined) {
    out.name = request.name;
  }
  return out;
}
