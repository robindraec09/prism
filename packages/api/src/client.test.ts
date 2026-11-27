import { inspect } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createHttpClient,
  HttpRequestError,
  HttpTimeoutError,
  type HttpClient,
  type Middleware,
  type RequestMetrics,
} from './index.js';
import { startTestServer, type Echo, type TestServer } from './test-utils/server.js';

let server: TestServer;
let api: HttpClient;

beforeAll(async () => {
  server = await startTestServer();
  api = createHttpClient({ baseURL: server.url });
});

afterAll(async () => {
  await api.close();
  await server.close();
});

async function rejection(promise: Promise<unknown>): Promise<HttpRequestError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpRequestError);
    return err as HttpRequestError;
  }
  throw new Error('expected the request to fail');
}

describe('methods, URLs and query', () => {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'options'] as const;
  it.each(methods)('sends %s with the right method', async (method: (typeof methods)[number]) => {
    const echo = await api[method]('/echo').json<Echo>();
    expect(echo.method).toBe(method.toUpperCase());
  });

  it('sends HEAD and returns an empty body', async () => {
    const res = await api.head('/echo');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  it('sends any method token through request()', async () => {
    const echo = await api.request('/echo', { method: 'propfind' }).json<Echo>();
    expect(echo.method).toBe('PROPFIND');
  });

  it('appends request paths to the base URL path', async () => {
    const scoped = api.extend({ baseURL: `${server.url}/api/v1/` });
    const echo = await scoped.get('/orders').json<Echo>();
    expect(echo.url).toBe('/api/v1/orders');
  });

  it('uses absolute URLs as they are', async () => {
    const other = createHttpClient({ baseURL: 'http://example.invalid' });
    const echo = await other.get(`${server.url}/echo`).json<Echo>();
    expect(echo.url).toBe('/echo');
    await other.close();
  });

  it('rejects a relative URL without a base URL, with a hint', async () => {
    const bare = createHttpClient();
    await expect(bare.get('/echo')).rejects.toThrow(/without a base URL.*baseURL/);
    await bare.close();
  });

  it('rejects non-HTTP protocols', async () => {
    await expect(api.get('ftp://127.0.0.1/file')).rejects.toThrow(
      /Unsupported URL protocol "ftp:"/,
    );
  });

  it('appends query parameters, repeating arrays and skipping null and undefined', async () => {
    const echo = await api
      .get('/echo?fixed=1', {
        query: { q: 'a b', page: 2, on: true, tag: ['x', 'y'], none: null, missing: undefined },
      })
      .json<Echo>();
    expect(echo.url).toBe('/echo?fixed=1&q=a+b&page=2&on=true&tag=x&tag=y');
  });

  it('accepts URLSearchParams as query', async () => {
    const echo = await api.get('/echo', { query: new URLSearchParams([['k', 'v']]) }).json<Echo>();
    expect(echo.url).toBe('/echo?k=v');
  });
});

describe('headers', () => {
  it('merges default and request headers case-insensitively; undefined removes one', async () => {
    const client = api.extend({ headers: { 'X-Default': 'd', 'X-Remove': 'r', Accept: 'a' } });
    const echo = await client
      .get('/echo', { headers: { 'x-default': 'override', 'X-Remove': undefined, 'X-Num': 3 } })
      .json<Echo>();
    expect(echo.headers['x-default']).toBe('override');
    expect(echo.headers['x-remove']).toBeUndefined();
    expect(echo.headers['x-num']).toBe('3');
    expect(echo.headers.accept).toBe('a');
  });

  it('fails with INVALID_REQUEST for a header value Node refuses', async () => {
    const err = await rejection(api.get('/echo', { headers: { 'x-bad': 'a\nb' } }));
    expect(err.code).toBe('INVALID_REQUEST');
  });
});

describe('bodies', () => {
  it('serialises json with a JSON content type and length', async () => {
    const echo = await api.post('/echo', { json: { sku: 'TSHIRT-M', qty: 2 } }).json<Echo>();
    expect(JSON.parse(echo.body)).toEqual({ sku: 'TSHIRT-M', qty: 2 });
    expect(echo.headers['content-type']).toBe('application/json');
    expect(echo.headers['content-length']).toBe(String(Buffer.byteLength(echo.body)));
  });

  it('keeps an explicit content type', async () => {
    const echo = await api
      .post('/echo', { json: [1], headers: { 'Content-Type': 'application/vnd.api+json' } })
      .json<Echo>();
    expect(echo.headers['content-type']).toBe('application/vnd.api+json');
  });

  it('sends text bodies as UTF-8', async () => {
    const echo = await api.put('/echo', { body: 'héllo' }).json<Echo>();
    expect(echo.body).toBe('héllo');
    expect(echo.headers['content-type']).toBe('text/plain;charset=utf-8');
    expect(echo.headers['content-length']).toBe('6');
  });

  it('sends byte bodies', async () => {
    const bytes = new Uint8Array([0, 104, 105, 0]).subarray(1, 3);
    const echo = await api.post('/echo', { body: bytes }).json<Echo>();
    expect(echo.body).toBe('hi');
    expect(echo.headers['content-type']).toBe('application/octet-stream');
  });

  it('refuses json and body together', async () => {
    await expect(api.post('/echo', { json: {}, body: 'x' })).rejects.toThrow(
      /cannot have both `json` and `body`/,
    );
  });
});

describe('responses', () => {
  it('returns error statuses as responses, not errors', async () => {
    const res = await api.get('/status/503');
    expect(res.status).toBe(503);
    expect(res.ok).toBe(false);
    expect(res.statusText).toBe('Service Unavailable');
    expect(res.text()).toBe('status 503');
  });

  it('exposes headers, case-insensitive lookup and set-cookie as a list', async () => {
    const res = await api.get('/cookies');
    expect(res.header('X-Multi')).toBe('a, b');
    expect(res.headers['x-multi']).toBe('a, b');
    expect(res.getSetCookie()).toEqual(['sid=secret-session; HttpOnly', 'theme=dark']);
  });

  it('decodes text with the charset from content-type', async () => {
    expect((await api.get('/latin1')).text()).toBe('café');
  });

  it('reads large bodies whole', async () => {
    const res = await api.get('/large', { query: { bytes: 3_000_000 } });
    expect(res.body.length).toBe(3_000_000);
  });

  it('explains a body that is not JSON', async () => {
    const res = await api.get('/not-json');
    expect(() => res.json()).toThrow(SyntaxError);
    expect(() => res.json()).toThrow(
      /GET http:\/\/127\.0\.0\.1:\d+\/not-json \(status 200, content-type text\/html\) is not valid JSON.*Body starts with: "<html>oops<\/html>"/,
    );
  });

  it('offers json() and text() on the response promise', async () => {
    expect(await api.get('/status/200').text()).toBe('status 200');
    expect(await api.get('/echo').json<Echo>()).toMatchObject({ method: 'GET' });
  });

  it('reports phase timings', async () => {
    const res = await api.get('/echo');
    const t = res.timings;
    for (const value of Object.values(t)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(t.total).toBeGreaterThan(0);
    expect(t.ttfb).toBeLessThanOrEqual(t.total);
    expect(res.elapsed).toBeGreaterThanOrEqual(t.total);
  });
});

describe('connections', () => {
  it('reuses keep-alive connections', async () => {
    const client = createHttpClient({ baseURL: server.url });
    const before = server.connections();
    for (let i = 0; i < 5; i++) {
      await client.get('/echo');
    }
    expect(server.connections() - before).toBe(1);
    await client.close();
  });

  it('fails with NETWORK when the connection is refused', async () => {
    const closed = await startTestServer();
    const url = closed.url;
    await closed.close();
    const err = await rejection(api.get(`${url}/echo`));
    expect(err.code).toBe('NETWORK');
    expect(err.message).toMatch(/ECONNREFUSED/);
  });

  it('fails with NETWORK when the server drops the connection', async () => {
    const err = await rejection(api.get('/reset'));
    expect(err.code).toBe('NETWORK');
  });
});

describe('timeouts and abort', () => {
  it('times out while waiting for headers, with a clear message', async () => {
    const err = await rejection(api.get('/slow-headers', { query: { ms: 2000 }, timeout: 50 }));
    expect(err).toBeInstanceOf(HttpTimeoutError);
    expect(err.code).toBe('TIMEOUT');
    const timeout = err as HttpTimeoutError;
    expect(timeout.phase).toBe('response');
    expect(timeout.timeout).toBe(50);
    expect(err.message).toMatch(
      /^GET http:\/\/127\.0\.0\.1:\d+\/slow-headers\?ms=2000 timed out after 50 ms while waiting for the response headers\. Raise `timeout`/,
    );
  });

  it('times out while reading the body', async () => {
    const err = await rejection(api.get('/slow-body', { query: { ms: 2000 }, timeout: 100 }));
    expect((err as HttpTimeoutError).phase).toBe('body');
  });

  it('uses the client default timeout', async () => {
    const quick = api.extend({ timeout: 50 });
    const err = await rejection(quick.get('/slow-headers', { query: { ms: 2000 } }));
    expect((err as HttpTimeoutError).timeout).toBe(50);
  });

  it('timeout 0 disables the limit', async () => {
    const res = await api.get('/slow-headers', { query: { ms: 30 }, timeout: 0 });
    expect(res.text()).toBe('late');
  });

  it('rejects invalid timeouts', async () => {
    await expect(api.get('/echo', { timeout: -1 })).rejects.toThrow(RangeError);
    expect(() => createHttpClient({ timeout: Number.NaN })).toThrow(RangeError);
  });

  it('aborts with a signal', async () => {
    const controller = new AbortController();
    const pending = api.get('/slow-headers', { query: { ms: 2000 }, signal: controller.signal });
    setTimeout(() => {
      controller.abort();
    }, 20);
    expect((await rejection(pending)).code).toBe('ABORTED');
  });

  it('rejects at once when the signal is already aborted', async () => {
    const err = await rejection(api.get('/echo', { signal: AbortSignal.abort() }));
    expect(err.code).toBe('ABORTED');
  });
});

describe('redirects', () => {
  it('follows redirects by default and records the hops', async () => {
    const res = await api.get('/redirect', { query: { to: '/redirect?to=/echo' } });
    expect(res.status).toBe(200);
    expect(res.url).toBe(`${server.url}/echo`);
    expect(res.redirects).toEqual([
      `${server.url}/redirect?to=%2Fredirect%3Fto%3D%2Fecho`,
      `${server.url}/redirect?to=/echo`,
    ]);
  });

  it('turns POST into GET without a body on 302 and 303', async () => {
    for (const status of [302, 303]) {
      const echo = await api
        .post('/redirect', { query: { status, to: '/echo' }, json: { a: 1 } })
        .json<Echo>();
      expect(echo.method).toBe('GET');
      expect(echo.body).toBe('');
      expect(echo.headers['content-type']).toBeUndefined();
    }
  });

  it('keeps method and body on 307 and 308', async () => {
    for (const status of [307, 308]) {
      const echo = await api
        .post('/redirect', { query: { status, to: '/echo' }, json: { a: 1 } })
        .json<Echo>();
      expect(echo.method).toBe('POST');
      expect(echo.body).toBe('{"a":1}');
    }
  });

  it('drops credentials on a redirect to another origin', async () => {
    const other = await startTestServer();
    try {
      const echo = await api
        .get('/redirect', {
          query: { to: `${other.url}/echo` },
          headers: { authorization: 'Bearer t', cookie: 'sid=1', 'x-keep': 'k' },
        })
        .json<Echo>();
      expect(echo.headers.authorization).toBeUndefined();
      expect(echo.headers.cookie).toBeUndefined();
      expect(echo.headers['x-keep']).toBe('k');
    } finally {
      await other.close();
    }
  });

  it('keeps credentials on a same-origin redirect', async () => {
    const echo = await api
      .get('/redirect', { query: { to: '/echo' }, headers: { authorization: 'Bearer t' } })
      .json<Echo>();
    expect(echo.headers.authorization).toBe('Bearer t');
  });

  it('returns the redirect with redirect: manual', async () => {
    const res = await api.get('/redirect', { query: { to: '/echo' }, redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.header('location')).toBe('/echo');
  });

  it('fails with REDIRECT_BLOCKED with redirect: error', async () => {
    const err = await rejection(api.get('/redirect', { redirect: 'error' }));
    expect(err.code).toBe('REDIRECT_BLOCKED');
  });

  it('fails with TOO_MANY_REDIRECTS past maxRedirects', async () => {
    const err = await rejection(api.get('/loop', { maxRedirects: 3 }));
    expect(err.code).toBe('TOO_MANY_REDIRECTS');
    expect(err.message).toMatch(/more than 3 times/);
  });
});

describe('middleware', () => {
  it('runs middleware in order around the transport and lets it change the request', async () => {
    const order: string[] = [];
    const outer: Middleware = async (req, next) => {
      order.push('outer:before');
      const res = await next(req);
      order.push('outer:after');
      return res;
    };
    const inner: Middleware = async (req, next) => {
      order.push('inner:before');
      req.headers['x-added'] = 'yes';
      const res = await next(req);
      order.push('inner:after');
      return res;
    };
    const client = api.extend({ middleware: [outer, inner] });
    const echo = await client.get('/echo').json<Echo>();
    expect(echo.headers['x-added']).toBe('yes');
    expect(order).toEqual(['outer:before', 'inner:before', 'inner:after', 'outer:after']);
  });

  it('can call next more than once (retry)', async () => {
    const statuses: number[] = [];
    const retry: Middleware = async (req, next) => {
      const first = await next(req);
      statuses.push(first.status);
      if (first.status !== 503) {
        return first;
      }
      req.url = new URL(`${server.url}/status/200`);
      const second = await next(req);
      statuses.push(second.status);
      return second;
    };
    const res = await api.extend({ middleware: [retry] }).get('/status/503');
    expect(res.status).toBe(200);
    expect(statuses).toEqual([503, 200]);
  });

  it('sets content-length from a body changed by middleware', async () => {
    const rewrite: Middleware = (req, next) => {
      req.body = Buffer.from('longer body');
      return next(req);
    };
    const echo = await api
      .extend({ middleware: [rewrite] })
      .post('/echo', { body: 'x' })
      .json<Echo>();
    expect(echo.body).toBe('longer body');
  });

  it('turns a middleware that throws synchronously into a rejection', async () => {
    const broken: Middleware = () => {
      throw new Error('boom');
    };
    await expect(api.extend({ middleware: [broken] }).get('/echo')).rejects.toThrow('boom');
  });
});

describe('metrics hooks', () => {
  it('reports one record per exchange with timings, bytes, status, name and tags', async () => {
    const records: RequestMetrics[] = [];
    const client = createHttpClient({
      baseURL: server.url,
      tags: { scenario: 'checkout' },
      onMetrics: (m) => records.push(m),
    });
    await client.post('/echo', { json: { a: 1 }, name: 'create order', tags: { step: '1' } });
    await client.get('/echo');
    await client.close();

    expect(records).toHaveLength(2);
    const [first, second] = records as [RequestMetrics, RequestMetrics];
    expect(first).toMatchObject({
      name: 'create order',
      method: 'POST',
      url: `${server.url}/echo`,
      status: 200,
      error: undefined,
      redirect: false,
      socketReused: false,
      tags: { scenario: 'checkout', step: '1' },
    });
    expect(first.bytesSent).toBeGreaterThan(Buffer.byteLength('{"a":1}'));
    expect(first.bytesReceived).toBeGreaterThan(0);
    expect(first.timings.connect).toBeGreaterThan(0);
    expect(first.startTime).toBeGreaterThan(Date.now() - 60_000);
    expect(second.socketReused).toBe(true);
    expect(second.timings.connect).toBe(0);
    expect(second.tags).toEqual({ scenario: 'checkout' });
  });

  it('reports each redirect hop', async () => {
    const records: RequestMetrics[] = [];
    await api
      .extend({ onMetrics: (m) => records.push(m) })
      .get('/redirect', { query: { to: '/echo' } });
    expect(records.map((m) => [m.status, m.redirect])).toEqual([
      [302, true],
      [200, false],
    ]);
  });

  it('reports failures with the error and no status', async () => {
    const records: RequestMetrics[] = [];
    await rejection(
      api
        .extend({ onMetrics: (m) => records.push(m) })
        .get('/slow-headers', { query: { ms: 2000 }, timeout: 30 }),
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBeUndefined();
    expect(records[0]?.error?.code).toBe('TIMEOUT');
  });

  it('masks secrets in the reported URL', async () => {
    const records: RequestMetrics[] = [];
    await api
      .extend({ onMetrics: (m) => records.push(m) })
      .get('/echo', { query: { token: 's3cr3t' } });
    expect(records[0]?.url).toBe(`${server.url}/echo?token=***`);
  });

  it('ignores a hook that throws and warns instead', async () => {
    const warnings: string[] = [];
    const onWarning = (w: Error): void => {
      warnings.push(w.message);
    };
    process.on('warning', onWarning);
    try {
      const client = api.extend({
        onMetrics: () => {
          throw new Error('sink down');
        },
      });
      expect((await client.get('/echo')).status).toBe(200);
      await new Promise((resolve) => setImmediate(resolve));
      expect(warnings.some((w) => w.includes('sink down'))).toBe(true);
    } finally {
      process.off('warning', onWarning);
    }
  });
});

describe('secret masking', () => {
  const secretClient = (): HttpClient =>
    api.extend({
      headers: {
        Authorization: 'Bearer abc.def.ghi',
        'X-Tenant-Secret': 'tenant-value',
        'X-Custom': 'c',
      },
      maskHeaders: ['x-custom'],
    });

  it('masks the request in responses, JSON and console output', async () => {
    const res = await secretClient().get('/echo', {
      headers: { cookie: 'sid=1' },
      query: { api_key: 'k' },
    });
    expect(res.request.headers).toMatchObject({
      authorization: 'Bearer ***',
      'x-tenant-secret': '***',
      'x-custom': '***',
      cookie: '***',
    });
    expect(res.request.url).toMatch(/\?api_key=\*\*\*$/);
    for (const text of [JSON.stringify(res), inspect(res, { depth: 5 })]) {
      expect(text).not.toContain('abc.def.ghi');
      expect(text).not.toContain('tenant-value');
      expect(text).not.toContain('sid=1');
      expect(text).not.toContain('api_key=k');
    }
  });

  it('masks set-cookie when a response is serialised', async () => {
    const res = await api.get('/cookies');
    expect(JSON.stringify(res)).not.toContain('secret-session');
    expect(res.getSetCookie()[0]).toContain('secret-session');
  });

  it('masks the prepared request when middleware logs it', async () => {
    const logged: string[] = [];
    const log: Middleware = (req, next) => {
      logged.push(inspect(req), JSON.stringify(req));
      return next(req);
    };
    await secretClient()
      .extend({ middleware: [log] })
      .get('/echo');
    expect(logged.join('\n')).not.toContain('abc.def.ghi');
    expect(logged.join('\n')).toContain('Bearer ***');
  });

  it('masks errors', async () => {
    const err = await rejection(
      secretClient().get('/slow-headers', { query: { ms: 2000, password: 'pw' }, timeout: 20 }),
    );
    expect(err.request.headers.authorization).toBe('Bearer ***');
    expect(err.message).toContain('password=***');
    expect(JSON.stringify(err.request)).not.toContain('abc.def.ghi');
  });
});

describe('extend and close', () => {
  it('shares connection pools with extended clients; close on a child closes nothing', async () => {
    const root = createHttpClient({ baseURL: server.url });
    const child = root.extend({ headers: { 'x-child': '1' } });
    const before = server.connections();
    await root.get('/echo');
    await child.get('/echo');
    await child.close();
    await root.get('/echo');
    expect(server.connections() - before).toBe(1);
    await root.close();
  });
});
