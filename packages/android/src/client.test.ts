import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentClient } from './client.js';
import { AgentError } from './protocol.js';

const token = 'Zm9vYmFyYmF6cXV4MDEyMzQ1Njc4OWFiY2RlZmdoaWo';

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}

function fixtureFor(body: Record<string, unknown> | undefined): string {
  switch (body?.['cmd']) {
    case 'hello':
      return 'hello';
    case 'session.start':
    case 'session.stop':
      return 'session-start';
    case 'tree.get':
      return 'tree-get';
    case 'action.tap': {
      const params = body['params'] as { target: { point: { x: number } } };
      return params.target.point.x > 360 ? 'action-tap-offscreen' : 'action-tap';
    }
    default:
      return 'action-tap-offscreen';
  }
}

/** Replays the agent fixtures, re-stamped with the request id, and records what it received. */
class FakeAgent {
  server: Server;
  requests: {
    headers: IncomingMessage['headers'];
    body: Record<string, unknown> | undefined;
    url: string;
  }[] = [];
  port = 0;
  stall = false;

  constructor() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
        this.requests.push({ headers: req.headers, body, url: req.url ?? '' });
        if (this.stall) return; // never answer
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(401).end();
          return;
        }
        let payload: Record<string, unknown>;
        if (req.url === '/version') payload = fixture('version');
        else {
          const name = fixtureFor(body);
          payload = { ...fixture(name), id: body?.['id'] };
        }
        const json = Buffer.from(JSON.stringify(payload));
        if (String(req.headers['accept-encoding']).includes('gzip') && json.length > 1024) {
          res
            .writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
            .end(gzipSync(json));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(json);
        }
      });
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

describe('AgentClient', () => {
  let agent: FakeAgent;
  let client: AgentClient;

  beforeEach(async () => {
    agent = new FakeAgent();
    await agent.start();
    client = new AgentClient({ hostPort: agent.port, token });
  });

  afterEach(async () => {
    client.close();
    await agent.stop();
  });

  it('runs hello, session, tree.get and tap with the right envelope and headers', async () => {
    const hello = await client.hello();
    expect(hello.agent.instanceId).toBe('k7q2xm4p');
    expect(client.selectedVersion).toBe('1.0');
    expect(await client.sessionStart()).toBe('k7q2xm4p.sess-1');
    const tree = await client.treeGet();
    expect(tree.nodeCount).toBe(6);
    expect(client.lastStats?.wireBytes).toBeLessThan(client.lastStats?.jsonBytes ?? 0); // gzip used
    expect(client.lastStats?.timing?.durationMs).toBe(3);
    const tap = await client.tap(180, 524);
    expect(tap.at).toEqual({ x: 180, y: 524 });

    const [h, s, t, a] = agent.requests;
    expect(h?.body).toMatchObject({
      v: '1.0',
      cmd: 'hello',
      params: { protocol: { min: '1.0', max: '1.0' } },
    });
    expect(h?.body).not.toHaveProperty('session');
    expect(s?.body).not.toHaveProperty('session');
    expect(t?.body).toMatchObject({ cmd: 'tree.get', session: 'k7q2xm4p.sess-1' });
    expect(a?.body).toMatchObject({
      cmd: 'action.tap',
      params: { target: { point: { x: 180, y: 524 } } },
    });
    expect(new Set(agent.requests.map((r) => r.body?.['id'])).size).toBe(4);
    for (const r of agent.requests) {
      expect(r.headers.authorization).toBe(`Bearer ${token}`);
      expect(r.headers.origin).toBeUndefined();
      expect(r.headers['accept-encoding']).toContain('gzip');
      expect(r.headers.host).toBe(`127.0.0.1:${agent.port}`);
    }
  });

  it('throws AgentError for ok:false answers', async () => {
    await client.sessionStart();
    const err = await client.tap(999, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('invalid-request');
  });

  it('reports HTTP 401 clearly', async () => {
    const bad = new AgentClient({ hostPort: agent.port, token: 'x'.repeat(43) });
    await expect(bad.version()).rejects.toThrow(/HTTP 401.*token/);
    bad.close();
  });

  it('synthesises agent-crashed when the agent does not answer in time', async () => {
    agent.stall = true;
    const err = await client.command('hello', {}, { timeoutMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('agent-crashed');
    expect((err as AgentError).retryable).toBe(true);
  }, 10_000);
});
