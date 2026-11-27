/* global Buffer, console, process */
// Measures the latency Prism's HTTP engine adds over a bare node:http request (PRD: < 5 ms).
// Run after a build: `pnpm --filter @prismtest/api build && pnpm --filter @prismtest/api bench`.
// Client and server share one process, so absolute numbers are pessimistic; compare the rows.
import http from 'node:http';

import { createHttpClient } from '../dist/index.js';

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 20_000);
const WARMUP = 2_000;
const ROUNDS = 5;

const server = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const agent = new http.Agent({ keepAlive: true });
function bare() {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/x`, { agent }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.end();
  });
}

const plain = createHttpClient({ baseURL: base });
let sink = 0;
const full = createHttpClient({
  baseURL: base,
  headers: { authorization: 'Bearer secret' },
  middleware: [(req, next) => next(req)],
  onMetrics: (m) => {
    sink += m.timings.total;
  },
});

const cases = {
  'bare node:http': bare,
  'prism get().json()': () => plain.get('/x').json(),
  'prism post json + middleware + metrics hook': () => full.post('/x', { json: { a: 1 } }).json(),
};

async function microsPerRequest(fn) {
  for (let i = 0; i < WARMUP; i++) await fn();
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) await fn();
  return Number(process.hrtime.bigint() - start) / 1000 / ITERATIONS;
}

const results = Object.fromEntries(Object.keys(cases).map((name) => [name, []]));
for (let round = 0; round < ROUNDS; round++) {
  for (const [name, fn] of Object.entries(cases)) {
    results[name].push(await microsPerRequest(fn));
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const baseline = median(results['bare node:http']);
console.log(`${ITERATIONS} sequential keep-alive requests x ${ROUNDS} rounds, median per request:`);
for (const [name, values] of Object.entries(results)) {
  const value = median(values);
  const delta = value - baseline;
  console.log(
    `  ${name.padEnd(46)} ${value.toFixed(1).padStart(7)} us  (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} us)`,
  );
}

await plain.close();
await full.close();
agent.destroy();
server.close();
if (sink < 0) console.log(sink);
