import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What `/echo` answers with. */
export interface Echo {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A local HTTP server for tests. No external network is used. */
export interface TestServer {
  /** Base URL, for example `http://127.0.0.1:54321`. */
  url: string;
  /** Number of TCP connections accepted so far. */
  connections(): number;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://test.local');
  const body = await readBody(req);
  const path = url.pathname;

  if (path === '/echo' || path.startsWith('/api/')) {
    const echo: Echo = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(echo));
    return;
  }

  const status = /^\/status\/(\d{3})$/.exec(path);
  if (status) {
    res.writeHead(Number(status[1]), { 'content-type': 'text/plain' });
    res.end(`status ${status[1]}`);
    return;
  }

  // /redirect?status=302&to=/echo
  if (path === '/redirect') {
    res.writeHead(Number(url.searchParams.get('status') ?? '302'), {
      location: url.searchParams.get('to') ?? '/echo',
    });
    res.end();
    return;
  }

  // /loop redirects to itself forever.
  if (path === '/loop') {
    res.writeHead(302, { location: '/loop' });
    res.end();
    return;
  }

  if (path === '/slow-headers') {
    const ms = Number(url.searchParams.get('ms') ?? '1000');
    setTimeout(() => {
      if (!res.destroyed) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('late');
      }
    }, ms).unref();
    return;
  }

  if (path === '/slow-body') {
    const ms = Number(url.searchParams.get('ms') ?? '1000');
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('start ');
    setTimeout(() => {
      if (!res.destroyed) {
        res.end('end');
      }
    }, ms).unref();
    return;
  }

  if (path === '/latin1') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' });
    res.end(Buffer.from([0x63, 0x61, 0x66, 0xe9])); // "café" in Latin-1
    return;
  }

  if (path === '/cookies') {
    res.writeHead(200, {
      'set-cookie': ['sid=secret-session; HttpOnly', 'theme=dark'],
      'x-multi': ['a', 'b'],
    });
    res.end();
    return;
  }

  if (path === '/not-json') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>oops</html>');
    return;
  }

  if (path === '/large') {
    const size = Number(url.searchParams.get('bytes') ?? '1000000');
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(Buffer.alloc(size, 0x61));
    return;
  }

  if (path === '/reset') {
    req.socket.destroy();
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}

/**
 * Starts a local test server on a random port of 127.0.0.1.
 *
 * Routes: `/echo` (and `/api/*`) echo the request as JSON; `/status/<code>`;
 * `/redirect?status=&to=`; `/loop`; `/slow-headers?ms=`; `/slow-body?ms=`;
 * `/latin1`; `/cookies`; `/not-json`; `/large?bytes=`; `/reset` destroys the socket.
 */
export async function startTestServer(): Promise<TestServer> {
  let connections = 0;
  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      res.destroy(err as Error);
    });
  });
  server.on('connection', () => {
    connections++;
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    connections: () => connections,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
