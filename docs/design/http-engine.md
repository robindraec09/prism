# Design note: HTTP engine v0

| | |
| --- | --- |
| Task | P0-13 |
| Requirements | API-1 (partly, see §8), groundwork for API-2, API-3, API-8, PERF-1, PERF-3, PERF-5 |
| Package | `@prismtest/api` (`packages/api`, private, MIT, no runtime dependencies) |
| Status | Draft for review. The metrics hook interface (§5) needs sign-off from `perf-engineer` (P0-12) |

## 1. Goal

One request pipeline that API tests and the load engine share (PRD architecture: "HTTP engine: one request pipeline (auth, retries, schema checks, metrics) for API tests and load tests"). v0 covers: all methods, headers, query, JSON and text bodies, base URL, redirects, timeouts, response helpers, a middleware pipeline, metrics hooks and secret masking. It must add less than 5 ms per request (PRD non-functional "API speed") and, for load tests, less than 1 ms on reported p95 ("Measurement accuracy").

## 2. Transport: `node:http` / `node:https`, not `fetch`

Both are built into Node, so neither adds a dependency. We use `node:http` and `node:https` with a keep-alive `Agent` per client.

| Need | `node:http` | Built-in `fetch` (bundled undici) |
| --- | --- | --- |
| Phase timings (dns, connect, tls, ttfb) per request | Socket events `lookup`, `connect`, `secureConnect` and `ClientRequest` events give every phase directly | No per-request timing API. Resource Timing entries go to a global, size-limited buffer and have to be matched back to requests; `diagnostics_channel` hooks are undici-internal |
| Wire bytes sent and received | `socket.bytesWritten` / `bytesRead` deltas | Not exposed |
| Redirect control (per-hop metrics, credential stripping, hop list) | We run the loop, so each hop is observable | `redirect: 'follow'` hides the hops and their timings; with `manual` we would still re-implement the loop |
| Connection pool control for the load engine (PERF-5) | `Agent` options (`maxSockets`, `keepAlive`), shareable, injectable | Needs `undici.Agent` as a dispatcher, which is not importable without installing `undici` |
| Overhead | Thin; measured below | WHATWG `Request`/`Response`/streams objects per call; slower than undici's own `request()` |
| HTTP/2 | Not in `node:http` (separate `node:http2`) | Not by default either |

The trade-off: we implement redirects, body encoding and timeouts ourselves (about 300 lines), and HTTP/2 needs a separate transport later. In exchange we get exact timings and byte counts, which PERF-3 needs, and full control of the hot path.

## 3. Pipeline

```
client.post(url, options)
  └─ prepare: base URL + path, query, merged headers (lower-case), body encoding, defaults
      └─ middleware[0] ─▶ middleware[1] ─▶ … (composed once per client, not per request)
          └─ transport: redirect loop
              └─ exchange: one HTTP request on a pooled socket, read whole body, timings
                  └─ onMetrics hooks (once per exchange, synchronous)
```

- **`createHttpClient(options)`** returns an `HttpClient` with `request`, `get`, `head`, `post`, `put`, `patch`, `delete`, `options`, `extend` and `close`. Every method returns a `ResponsePromise`: a `Promise<HttpResponse>` with `.json()` and `.text()`, so the PRD sketch `await api.post('/orders', { json }).json()` works as written.
- **Middleware** is `(request, next) => Promise<HttpResponse>`, Koa-style. It may change the `PreparedRequest`, call `next` several times (retries), or replace the response. Auth (API-2), retries, logging and request mocking (API-9) are planned as middleware. The chain wraps the whole redirect loop, so auth runs once per logical request and retries cover all hops.
- **`extend(options)`** layers options over a client (headers and tags merged; middleware, hooks and masked names appended; scalars replaced) and shares the parent's connection pools. A load test creates one client and extends it per virtual user without opening extra pools.
- **`close()`** destroys pools the client created. Agents passed in `agents` are never destroyed.

## 4. Semantics

- **URLs.** Relative paths are appended to `baseURL`'s path (`http://h/api` + `/users` → `http://h/api/users`), unlike `new URL(path, base)`, which would drop `/api`. Absolute URLs bypass `baseURL`. Only `http:` and `https:`.
- **Query.** `query` is appended to any query already in the URL; arrays repeat the key; `null`/`undefined` are skipped. `URLSearchParams` is accepted.
- **Headers.** Names are lower-cased. Request headers override defaults; `undefined`/`null` removes a default.
- **Bodies.** `json` → `JSON.stringify`, `content-type: application/json`. `body: string` → UTF-8, `text/plain;charset=utf-8`. `body: Uint8Array` → `application/octet-stream`. An explicit content type always wins. `json` and `body` together are a `TypeError`. `content-length` is set by the transport from the final body, so middleware can change the body safely.
- **Methods.** Any method token, sent upper-cased.
- **Timeouts.** `timeout` (default 30 000 ms, `0` = none) bounds the whole logical request: queueing for a socket, connect, send, all redirect hops and reading the body. On expiry the socket is destroyed and the promise rejects with `HttpTimeoutError` naming the phase (`queue`, `connect`, `send`, `response`, `body`), for example: `GET http://127.0.0.1:4000/slow timed out after 50 ms while waiting for the response headers. Raise \`timeout\` for this request, or in createHttpClient({ timeout }), if the server is expected to be this slow.` A retry middleware gets a fresh budget per `next` call.
- **Abort.** `signal` rejects with code `ABORTED`, also when already aborted.
- **Redirects.** `follow` (default, up to `maxRedirects` = 20), `manual` (return the 3xx), `error` (reject with `REDIRECT_BLOCKED`). As in the Fetch standard: 303 (except HEAD) and 301/302 on POST become GET without body or body headers; 307/308 keep method and body; `authorization`, `proxy-authorization` and `cookie` are dropped on a cross-origin hop. `res.redirects` lists the URLs that redirected.
- **Errors.** HTTP error statuses are responses, never exceptions (tests assert on them). `HttpRequestError` with `code` `TIMEOUT` | `ABORTED` | `NETWORK` | `TOO_MANY_REDIRECTS` | `REDIRECT_BLOCKED` | `INVALID_REQUEST` is thrown only when there is no usable response. It carries the masked request and the original error as `cause`.
- **Responses.** The body is read whole into a `Buffer` (v0). `status`, `statusText`, `ok`, `url`, `headers` (lower-case, repeated values joined with `", "`), `header(name)`, `getSetCookie()`, `text()` (charset from `content-type`, UTF-8 by default), `json<T>()` (a `SyntaxError` that names the request, status, content type and the first 200 characters of the body), `timings`, `elapsed` (all hops), `redirects`, `request` (masked). `text()` and `json()` are synchronous because the body is already in memory.
- **Compression.** v0 sends no `accept-encoding` and does not decompress; see follow-ups.

## 5. Metrics hooks (interface for `perf-engineer`)

```ts
type MetricsHook = (metrics: RequestMetrics) => void;

interface RequestMetrics {
  name: string | undefined;          // request `name` option: the PERF-3 grouping key
  method: string;
  url: string;                       // masked
  status: number | undefined;        // undefined when the exchange failed
  error: HttpRequestError | undefined;
  redirect: boolean;                 // a 3xx being followed
  startTime: number;                 // epoch ms, fractional (performance.timeOrigin + now)
  timings: HttpTimings;              // queued, dns, connect, tls, send, wait, receive, ttfb, total (ms)
  bytesSent: number;                 // socket deltas, HTTP/1.1 bytes before TLS
  bytesReceived: number;
  socketReused: boolean;
  tags: Readonly<Record<string, string>>; // client tags merged with request tags
}
```

- Registered with `createHttpClient({ onMetrics })` or added with `extend({ onMetrics })`.
- Called **synchronously, once per network exchange**: each redirect hop and each failure produce a record. A logical request with two redirects produces three records; the load engine can count only `redirect === false` records as requests, or all of them as exchanges.
- **Zero cost when unused.** With no hooks the record is never built (one `length` check). Phase marks are always taken because `res.timings` needs them; they are a handful of `performance.now()` calls, and socket listeners are attached only to new connections and removed once they fire.
- Hooks must be cheap and must not do I/O: record into a histogram or a shared buffer and aggregate elsewhere (PERF-5 workers will post aggregates, not records, to the main thread). A hook that throws does not fail the request; it raises a process warning with code `PRISM_METRICS_HOOK`.
- Timings come from `performance.now()` (monotonic, sub-millisecond). `ttfb` = start → response headers; `wait` = request written → response headers (server time).
- The load engine reuses the whole pipeline: `loadTest({ scenario: async ({ api }) => … })` gets an `HttpClient` made with `extend({ onMetrics, tags: { scenario, vu } })` from a per-worker root client. Pass `agents` to tune pooling (`maxSockets`) per worker.

Open for `perf-engineer`: whether `RequestMetrics` objects should be pooled or replaced by positional arguments if P0-12 finds allocation pressure at 5 000 req/s; the hook signature can change before the package is published.

## 6. Overhead

`packages/api/bench/overhead.mjs` (run with `pnpm --filter @prismtest/api build && pnpm --filter @prismtest/api bench`) sends 20 000 sequential keep-alive requests per row, 5 rounds, against a local server in the same process, and prints the median per request next to a bare `node:http` request that also reads and parses the body.

Measured on the agents' Linux container (2 vCPUs, Node 22.23):

| Row | Median per request | Added |
| --- | --- | --- |
| bare `node:http` + `JSON.parse` | 36–40 µs | — |
| `client.get('/x').json()` | 38–44 µs | **+2 to +4 µs** |
| `client.post('/x', { json })` with a middleware, an `authorization` header and a metrics hook | 47–59 µs | +10 to +18 µs (includes the request body the server reads) |

That is three orders of magnitude below the 5 ms budget. A rough concurrent run (50 in flight, same process) was within noise of bare `node:http`; the real throughput target belongs to P0-12.

## 7. Secret masking

- `maskHeaders`, `maskUrl` and `serializeRequest` are exported for logging middleware and reporters.
- Masked headers: `authorization` and `proxy-authorization` (scheme kept: `Bearer ***`), `cookie`, `set-cookie`, common API-key and token headers, any header whose name contains `token`, `secret`, `password`/`passwd`, `api-key`/`api_key`, `session`, `signature` or `credential`, and names from `maskHeaders` in the client options.
- Masked URL parts: the password in `user:password@`, and the values of query parameters whose names match the same pattern (`?api_key=***`).
- Where masking applies: `HttpRequestError.request` and messages, `RequestMetrics.url`, `res.request`, `JSON.stringify(res)` and `console.log(res)`, and `JSON.stringify` / `console.log` of the `PreparedRequest` middleware receives. Serialised responses and requests leave bodies out (they may hold tokens); only `bodyBytes` is reported. Reporters that want bodies will need a body-masking policy (follow-up).

## 8. Scope against API-1 and follow-ups

API-1 reads "REST client: all methods, headers, query, JSON/form/multipart, cookies, redirects, timeouts". P0-13 is "HTTP engine v0 (methods, headers, JSON bodies, timeouts, metrics hooks)". Not yet covered, proposed as roadmap tasks for `project-manager`:

| Follow-up | Requirement |
| --- | --- |
| Form (`application/x-www-form-urlencoded`) and multipart bodies (`form`, `multipart` options, file parts) | API-1 |
| Cookie jar middleware (per client / per session, shareable with UI tests) | API-1, API-8 |
| `accept-encoding` and gzip/br/deflate decompression with `node:zlib` | API-1 |
| Auth helpers as middleware: basic, bearer, API key, OAuth 2.0 client credentials, auth code with PKCE | API-2 |
| Retry middleware (idempotent methods, `Retry-After`, backoff) | PRD architecture |
| `expect(res).toHaveStatus()`, header, JSON-path and response-time matchers with retry | API-3 |
| `toMatchSchema()` (JSON Schema, OpenAPI 3.x) | API-4 |
| `api` fixture and `api.session` export for UI tests, with `core-engineer` | API-8 |
| Streaming responses and a max body size; HTTP/2 transport; proxy support (`HTTPS_PROXY`) | API-1, API-6 |
| HTTPS test in CI with a generated self-signed certificate (v0 verified HTTPS manually; CI tests use plain HTTP only) | API-1 |
| CommonJS build (P0-16) | PRD runtime |

## 9. Testing

Vitest tests in `packages/api/src/*.test.ts` start a local `node:http` server on `127.0.0.1:0` (`src/test-utils/server.ts`); no external network. They cover every method, base URL joining, query encoding, header merging, JSON/text/bytes bodies, charset decoding, large bodies, keep-alive reuse, refused and reset connections, timeouts in the response and body phases, abort, all redirect rules, middleware order and retries, metrics records (per hop, failures, masking, throwing hooks), and masking in responses, errors, logs and prepared requests.
