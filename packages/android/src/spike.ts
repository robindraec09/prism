/**
 * P0-09 measurement harness. Run on a machine with adb and an emulator:
 *
 * ```
 * node packages/android/dist/spike.js --agent-apk <agent.apk> --test-apk <test.apk> \
 *   [--serial emulator-5554] [--iterations 30] [--find-tap <testId>] [--tap 180,400] \
 *   [--hold-seconds 60 [--hold-tree-every-ms 1000]] [--dump-tree tree.json] [--out results.json]
 * ```
 *
 * See packages/android/README.md and docs/design/android-agent.md for the procedure.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Adb } from './adb.js';
import type { AgentClient, CallStats } from './client.js';
import { launchAgent } from './launcher.js';
import { summarize, type Summary } from './stats.js';
import { centerOf, findByTestId } from './tree.js';

interface Series {
  roundTripMs: Summary;
  agentMs: Summary;
  jsonBytes: Summary;
  wireBytes: Summary;
  nodeCount?: Summary;
}

/** Splits `"180,400"` into a DIP point. */
export function parsePoint(s: string): { x: number; y: number } {
  const [x, y, ...rest] = s.split(',').map((p) => Number(p.trim()));
  if (
    rest.length > 0 ||
    x === undefined ||
    y === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    throw new Error(`Expected a point as "x,y" in DIP, got ${JSON.stringify(s)}`);
  }
  return { x, y };
}

function series(stats: CallStats[], nodeCounts?: number[]): Series {
  const s: Series = {
    roundTripMs: summarize(stats.map((x) => x.roundTripMs)),
    agentMs: summarize(stats.map((x) => x.timing?.durationMs ?? NaN)),
    jsonBytes: summarize(stats.map((x) => x.jsonBytes)),
    wireBytes: summarize(stats.map((x) => x.wireBytes)),
  };
  if (nodeCounts) s.nodeCount = summarize(nodeCounts);
  return s;
}

async function measureTree(
  client: AgentClient,
  params: Record<string, unknown>,
  n: number,
): Promise<Series> {
  const stats: CallStats[] = [];
  const counts: number[] = [];
  await client.treeGet(params); // warm-up, not counted
  for (let i = 0; i < n; i++) {
    const snap = await client.treeGet(params);
    if (client.lastStats) stats.push(client.lastStats);
    counts.push(snap.nodeCount);
  }
  return series(stats, counts);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      serial: { type: 'string' },
      'agent-apk': { type: 'string' },
      'test-apk': { type: 'string' },
      iterations: { type: 'string', default: '30' },
      'find-tap': { type: 'string' },
      tap: { type: 'string' },
      'hold-seconds': { type: 'string' },
      'hold-tree-every-ms': { type: 'string', default: '0' },
      out: { type: 'string' },
      'dump-tree': { type: 'string' },
    },
  });
  const n = Number(values.iterations);
  if (!Number.isInteger(n) || n < 1) throw new Error('--iterations must be a positive integer');
  const adb = new Adb(values.serial !== undefined ? { serial: values.serial } : {});
  const log = (line: string): void => console.error(`[spike] ${line}`);

  const launchStarted = performance.now();
  const agent = await launchAgent({
    adb,
    ...(values['agent-apk'] !== undefined ? { agentApk: values['agent-apk'] } : {}),
    ...(values['test-apk'] !== undefined ? { testApk: values['test-apk'] } : {}),
    log,
  });
  const launchMs = performance.now() - launchStarted;
  const { client } = agent;
  const report: Record<string, unknown> = {
    date: new Date().toISOString(),
    device: agent.hello.device,
    agent: agent.hello.agent,
    capabilities: agent.hello.capabilities,
    launchMs: Math.round(launchMs),
    iterations: n,
  };
  try {
    await client.sessionStart();
    const snapshot = await client.treeGet({ webContent: 'include' });
    if (values['dump-tree']) {
      writeFileSync(values['dump-tree'], JSON.stringify(snapshot, null, 2));
      log(`tree written to ${values['dump-tree']}`);
    }

    log('measuring tree.get variants');
    report['treeGet'] = {
      default: await measureTree(client, {}, n),
      noRaw: await measureTree(client, { include: { raw: false } }, n),
      webContentInclude: await measureTree(client, { webContent: 'include' }, n),
      settle50: await measureTree(client, { settle: { maxWaitMs: 200, quietMs: 50 } }, n),
    };

    if (values.tap) {
      const p = parsePoint(values.tap);
      log(`measuring action.tap at ${p.x},${p.y}`);
      const stats: CallStats[] = [];
      for (let i = 0; i < n; i++) {
        await client.tap(p.x, p.y);
        if (client.lastStats) stats.push(client.lastStats);
      }
      report['tap'] = series(stats);
    }

    if (values['find-tap']) {
      // Phase 0 path (protocol.md §9.3 step 2 without element.find): tree.get with settle, host-side
      // match, tap the centre. Compare the total with the 300 ms target and the §9.4 budget.
      const testId = values['find-tap'];
      log(`measuring find + tap on testId ${testId}`);
      const totals: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const snap = await client.treeGet({ settle: { maxWaitMs: 200, quietMs: 50 } });
        const node = findByTestId(snap.root, testId);
        if (!node) throw new Error(`No node with testId ${testId} on screen (iteration ${i})`);
        const c = centerOf(node);
        await client.tap(c.x, c.y);
        totals.push(performance.now() - t0);
      }
      report['findTap'] = { testId, totalMs: summarize(totals), targetMedianMs: 300 };
    }

    if (values['hold-seconds']) {
      // Keeps the UiAutomation connection alive so WebView/Chromium accessibility cost and agent
      // memory can be measured with the agent attached (docs/design/android-agent.md §5, §7).
      // With --hold-tree-every-ms N, also takes a tree.get { webContent: include } every N ms.
      const seconds = Number(values['hold-seconds']);
      const every = Number(values['hold-tree-every-ms']);
      if (!(seconds > 0) || !(every >= 0))
        throw new Error('--hold-seconds must be > 0, --hold-tree-every-ms >= 0');
      log(
        `holding the agent connected for ${seconds} s${every > 0 ? `, tree.get every ${every} ms` : ''}`,
      );
      const end = Date.now() + seconds * 1000;
      let trees = 0;
      while (Date.now() < end) {
        if (every > 0) {
          await client.treeGet({ webContent: 'include' });
          trees++;
        } else {
          await client.command('device.info');
        }
        await new Promise((r) => setTimeout(r, every > 0 ? every : 5000));
      }
      report['hold'] = { seconds, treeEveryMs: every, trees };
    }
  } finally {
    await agent.stop();
  }
  const json = JSON.stringify(report, null, 2);
  if (values.out) writeFileSync(values.out, json);
  console.log(json);
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
