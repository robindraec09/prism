import type { QueryParams } from './types.js';

const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:/i;

/**
 * Resolves a request URL against an optional base URL. Unlike `new URL(path,
 * base)`, a path is appended to the base path: `http://h/api` + `/users`
 * gives `http://h/api/users`, not `http://h/users`. Absolute URLs are used as
 * they are. Only `http:` and `https:` are accepted.
 *
 * @internal
 */
export function resolveUrl(input: string | URL, base: URL | undefined): URL {
  let url: URL;
  if (input instanceof URL) {
    url = new URL(input.href);
  } else if (ABSOLUTE_URL.test(input)) {
    url = new URL(input);
  } else if (base !== undefined) {
    const prefix = new URL(base.href);
    prefix.search = '';
    prefix.hash = '';
    url = new URL(`${prefix.href.replace(/\/+$/, '')}/${input.replace(/^\/+/, '')}`);
  } else {
    throw new TypeError(
      `Cannot request the relative URL "${input}" without a base URL. ` +
        "Pass an absolute URL, or set createHttpClient({ baseURL: 'http://localhost:3000' }).",
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(
      `Unsupported URL protocol "${url.protocol}". Prism's HTTP engine supports http: and https:.`,
    );
  }
  return url;
}

/**
 * Appends query parameters to `url` in place. `null` and `undefined` values
 * are skipped; arrays repeat the key.
 *
 * @internal
 */
export function appendQuery(url: URL, query: QueryParams): void {
  const params = url.searchParams;
  if (query instanceof URLSearchParams) {
    for (const [key, value] of query) {
      params.append(key, value);
    }
    return;
  }
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value as readonly (string | number | boolean)[]) {
        params.append(key, String(item));
      }
    } else {
      params.append(key, String(value));
    }
  }
}
