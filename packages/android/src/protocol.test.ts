import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AgentError, buildRequest, parseResponse, type Snapshot } from './protocol.js';

/** Fixtures were produced by the Kotlin agent's Dispatcher on the JVM (see fixtures/README.md). */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

describe('buildRequest', () => {
  it('fills v and params and omits absent fields', () => {
    expect(buildRequest({ id: 'r-1', cmd: 'hello' })).toEqual({
      v: '1.0',
      id: 'r-1',
      cmd: 'hello',
      params: {},
    });
    expect(
      buildRequest({
        id: 'r-2',
        cmd: 'tree.get',
        session: 'k7q2xm4p.sess-1',
        params: { maxNodes: 10 },
        timeoutMs: 500,
      }),
    ).toEqual({
      v: '1.0',
      id: 'r-2',
      cmd: 'tree.get',
      session: 'k7q2xm4p.sess-1',
      params: { maxNodes: 10 },
      timeoutMs: 500,
    });
  });
});

describe('parseResponse', () => {
  it('accepts the agent tree.get fixture', () => {
    const res = parseResponse<Snapshot>(fixture('tree-get'), 'r-3');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.snapshotId).toBe('k7q2xm4p.s-1');
    expect(res.result.root.role).toBe('screen');
    expect(res.result.nodeCount).toBe(6);
  });

  it('accepts error envelopes', () => {
    const res = parseResponse(fixture('action-tap-offscreen'), 'r-5');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const err = new AgentError(res.error);
    expect(err.code).toBe('invalid-request');
    expect(err.retryable).toBe(false);
    expect(err.details).toEqual({ param: 'target.point' });
  });

  it('rejects envelopes that break the protocol', () => {
    expect(() => parseResponse(fixture('tree-get'), 'r-99')).toThrow(/does not match/);
    expect(() => parseResponse([], 'r-1')).toThrow(/object/);
    expect(() => parseResponse({ v: '1', id: 'r-1', ok: true }, 'r-1')).toThrow(/"v"/);
    expect(() => parseResponse({ v: '1.0', id: 'r-1', ok: true, timing: {} }, 'r-1')).toThrow(
      /result/,
    );
    expect(() => parseResponse({ v: '1.0', id: 'r-1', ok: true, result: {} }, 'r-1')).toThrow(
      /timing/,
    );
    expect(() =>
      parseResponse({ v: '1.0', id: 'r-1', ok: false, error: { code: 'x' } }, 'r-1'),
    ).toThrow(/error/);
    expect(() => parseResponse({ v: '1.0', id: 'r-1' }, 'r-1')).toThrow(/ok/);
  });
});
