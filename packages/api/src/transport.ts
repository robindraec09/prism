import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';

import { HttpRequestError, HttpTimeoutError, type TimeoutPhase } from './errors.js';
import { maskUrl, serializeRequest } from './mask.js';
import { HttpResponse } from './response.js';
import type {
  HttpTimings,
  MetricsHook,
  PreparedRequest,
  RequestHandler,
  RequestMetrics,
} from './types.js';

/** @internal Shared state of one client's transport. */
export interface TransportContext {
  hooks: readonly MetricsHook[];
  maskNames: ReadonlySet<string> | undefined;
  agentFor(protocol: string): http.Agent;
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

// Headers that describe the body; dropped when a redirect turns the request into a GET.
const BODY_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'content-language',
  'content-location',
];

// Credentials that must not follow a redirect to another origin (as in the Fetch standard).
const CREDENTIAL_HEADERS = ['authorization', 'proxy-authorization', 'cookie'];

interface Exchange {
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  timings: HttpTimings;
}

interface Marks {
  start: number;
  socket: number;
  lookup: number;
  connect: number;
  secure: number;
  sent: number;
  firstByte: number;
  end: number;
}

function computeTimings(m: Marks): HttpTimings {
  const end = m.end || performance.now();
  const socket = m.socket || end;
  const ready = m.secure || m.connect || socket;
  const sent = Math.max(m.sent || ready, ready);
  const firstByte = m.firstByte || end;
  return {
    queued: socket - m.start,
    dns: m.lookup ? m.lookup - socket : 0,
    connect: m.connect ? m.connect - (m.lookup || socket) : 0,
    tls: m.secure ? m.secure - m.connect : 0,
    send: sent - ready,
    wait: m.firstByte ? Math.max(0, firstByte - sent) : 0,
    receive: m.firstByte ? end - firstByte : 0,
    ttfb: m.firstByte ? firstByte - m.start : 0,
    total: end - m.start,
  };
}

function emit(hooks: readonly MetricsHook[], metrics: RequestMetrics): void {
  for (const hook of hooks) {
    try {
      hook(metrics);
    } catch (err) {
      process.emitWarning(
        `A Prism HTTP metrics hook threw and was ignored: ${err instanceof Error ? err.message : String(err)}`,
        { code: 'PRISM_METRICS_HOOK' },
      );
    }
  }
}

/** Performs one HTTP exchange (no redirects) and reads the whole body. */
function exchange(
  req: PreparedRequest,
  deadline: number,
  ctx: TransportContext,
): Promise<Exchange> {
  return new Promise<Exchange>((resolve, reject) => {
    const marks: Marks = {
      start: performance.now(),
      socket: 0,
      lookup: 0,
      connect: 0,
      secure: 0,
      sent: 0,
      firstByte: 0,
      end: 0,
    };
    const hooks = ctx.hooks;
    let phase: TimeoutPhase = 'queue';
    let settled = false;
    let socketRef: Socket | undefined;
    let written0 = 0;
    let read0 = 0;
    let socketReused = false;
    let timer: NodeJS.Timeout | undefined;
    let clientRequest: http.ClientRequest | undefined;
    const signal = req.signal;

    const report = (
      status: number | undefined,
      error: HttpRequestError | undefined,
      redirect: boolean,
      timings: HttpTimings,
    ): void => {
      if (hooks.length === 0) {
        return;
      }
      emit(hooks, {
        name: req.name,
        method: req.method,
        url: maskUrl(req.url),
        status,
        error,
        redirect,
        startTime: performance.timeOrigin + marks.start,
        timings,
        bytesSent: socketRef ? socketRef.bytesWritten - written0 : 0,
        bytesReceived: socketRef ? socketRef.bytesRead - read0 : 0,
        socketReused,
        tags: req.tags,
      });
    };

    const cleanup = (): void => {
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const fail = (error: HttpRequestError): void => {
      if (settled) {
        return;
      }
      cleanup();
      report(undefined, error, false, computeTimings(marks));
      clientRequest?.destroy();
      reject(error);
    };

    function onAbort(): void {
      fail(
        new HttpRequestError(
          `${req.method} ${maskUrl(req.url)} was aborted by its signal.`,
          'ABORTED',
          serializeRequest(req, ctx.maskNames),
          { cause: signal?.reason },
        ),
      );
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }

    const headers =
      req.body === undefined
        ? req.headers
        : { ...req.headers, 'content-length': String(req.body.length) };

    try {
      clientRequest = (req.url.protocol === 'https:' ? https : http).request(req.url, {
        method: req.method,
        headers,
        agent: ctx.agentFor(req.url.protocol),
      });
    } catch (cause) {
      fail(
        new HttpRequestError(
          `${req.method} ${maskUrl(req.url)} could not be sent: ${(cause as Error).message}`,
          'INVALID_REQUEST',
          serializeRequest(req, ctx.maskNames),
          { cause },
        ),
      );
      return;
    }
    const cr = clientRequest;

    signal?.addEventListener('abort', onAbort, { once: true });
    if (deadline !== Infinity) {
      timer = setTimeout(
        () => {
          fail(new HttpTimeoutError(serializeRequest(req, ctx.maskNames), req.timeout, phase));
        },
        Math.max(0, deadline - marks.start),
      );
    }

    cr.on('socket', (socket: Socket) => {
      marks.socket = performance.now();
      socketRef = socket;
      written0 = socket.bytesWritten;
      read0 = socket.bytesRead;
      socketReused = cr.reusedSocket;
      if (socket.connecting) {
        // Listeners are added once per new connection and removed when they are done, so
        // pooled sockets do not collect closures.
        phase = 'connect';
        const isHttps = req.url.protocol === 'https:';
        const onLookup = (): void => {
          marks.lookup = performance.now();
        };
        socket.once('lookup', onLookup);
        socket.once('connect', () => {
          marks.connect = performance.now();
          socket.removeListener('lookup', onLookup);
          if (!isHttps && phase === 'connect') {
            phase = 'send';
          }
        });
        if (isHttps) {
          socket.once('secureConnect', () => {
            marks.secure = performance.now();
            if (phase === 'connect') {
              phase = 'send';
            }
          });
        }
      } else {
        phase = 'send';
      }
    });

    cr.on('finish', () => {
      marks.sent = performance.now();
      if (phase === 'send' || phase === 'connect' || phase === 'queue') {
        phase = 'response';
      }
    });

    cr.on('response', (res: http.IncomingMessage) => {
      marks.firstByte = performance.now();
      phase = 'body';
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
      });
      res.on('end', () => {
        if (settled) {
          return;
        }
        marks.end = performance.now();
        cleanup();
        const status = res.statusCode ?? 0;
        const timings = computeTimings(marks);
        const redirect =
          req.redirect === 'follow' &&
          REDIRECT_STATUSES.has(status) &&
          res.headers.location !== undefined;
        report(status, undefined, redirect, timings);
        resolve({
          status,
          statusText: res.statusMessage ?? '',
          headers: res.headers,
          body: chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks, size),
          timings,
        });
      });
      res.on('error', (cause: Error) => {
        fail(networkError(req, ctx, cause));
      });
    });

    cr.on('error', (cause: Error) => {
      fail(networkError(req, ctx, cause));
    });

    cr.end(req.body);
  });
}

function networkError(req: PreparedRequest, ctx: TransportContext, cause: Error): HttpRequestError {
  const code = (cause as NodeJS.ErrnoException).code;
  return new HttpRequestError(
    `${req.method} ${maskUrl(req.url)} failed: ${cause.message}${code !== undefined && !cause.message.includes(code) ? ` (${code})` : ''}`,
    'NETWORK',
    serializeRequest(req, ctx.maskNames),
    { cause },
  );
}

/** Builds the request for the next redirect hop. */
function redirectRequest(req: PreparedRequest, status: number, location: URL): PreparedRequest {
  const headers = { ...req.headers };
  let method = req.method;
  let body = req.body;
  if (
    (status === 303 && method !== 'HEAD') ||
    ((status === 301 || status === 302) && method === 'POST')
  ) {
    method = 'GET';
    body = undefined;
    for (const name of BODY_HEADERS) {
      Reflect.deleteProperty(headers, name);
    }
  }
  if (location.origin !== req.url.origin) {
    for (const name of CREDENTIAL_HEADERS) {
      Reflect.deleteProperty(headers, name);
    }
  }
  return Object.assign(
    Object.create(Object.getPrototypeOf(req) as object) as PreparedRequest,
    req,
    {
      method,
      url: location,
      headers,
      body,
    },
  );
}

/**
 * Creates the pipeline's last step: sends the request, follows redirects
 * according to its policy and returns the response.
 *
 * @internal
 */
export function createTransport(ctx: TransportContext): RequestHandler {
  return async (request) => {
    const start = performance.now();
    const deadline = request.timeout > 0 ? start + request.timeout : Infinity;
    const redirects: string[] = [];
    let req = request;
    for (;;) {
      const ex = await exchange(req, deadline, ctx);
      const location = ex.headers.location;
      if (
        req.redirect === 'manual' ||
        !REDIRECT_STATUSES.has(ex.status) ||
        location === undefined
      ) {
        return new HttpResponse({
          status: ex.status,
          statusText: ex.statusText,
          headers: ex.headers,
          body: ex.body,
          url: req.url,
          timings: ex.timings,
          elapsed: performance.now() - start,
          redirects,
          request: req,
          maskNames: ctx.maskNames,
        });
      }
      let target: URL;
      try {
        target = new URL(location, req.url);
      } catch (cause) {
        throw new HttpRequestError(
          `${req.method} ${maskUrl(req.url)} answered ${ex.status} with an invalid Location header.`,
          'REDIRECT_BLOCKED',
          serializeRequest(req, ctx.maskNames),
          { cause },
        );
      }
      if (req.redirect === 'error') {
        throw new HttpRequestError(
          `${req.method} ${maskUrl(req.url)} answered ${ex.status} with a redirect to ${maskUrl(target)}, ` +
            "but the request uses redirect: 'error'. Use redirect: 'manual' to inspect the redirect, or 'follow' to follow it.",
          'REDIRECT_BLOCKED',
          serializeRequest(req, ctx.maskNames),
        );
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new HttpRequestError(
          `${req.method} ${maskUrl(req.url)} redirected to the unsupported protocol "${target.protocol}".`,
          'REDIRECT_BLOCKED',
          serializeRequest(req, ctx.maskNames),
        );
      }
      if (redirects.length >= req.maxRedirects) {
        throw new HttpRequestError(
          `${request.method} ${maskUrl(request.url)} was redirected more than ${req.maxRedirects} times ` +
            `(last hop: ${maskUrl(req.url)} -> ${maskUrl(target)}). Raise maxRedirects if this is expected.`,
          'TOO_MANY_REDIRECTS',
          serializeRequest(request, ctx.maskNames),
        );
      }
      redirects.push(req.url.href);
      req = redirectRequest(req, ex.status, target);
    }
  };
}
