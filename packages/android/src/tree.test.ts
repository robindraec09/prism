import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from './protocol.js';
import { centerOf, findByTestId, walk } from './tree.js';

const snapshot = (
  JSON.parse(readFileSync(new URL('./fixtures/tree-get.json', import.meta.url), 'utf8')) as {
    result: Snapshot;
  }
).result;

describe('tree helpers', () => {
  it('walks in pre-order', () => {
    expect([...walk(snapshot.root)].map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('finds by full or short testId and computes the centre', () => {
    const full = findByTestId(snapshot.root, 'com.example.shop:id/sign_in');
    const short = findByTestId(snapshot.root, 'sign_in');
    expect(full?.id).toBe('n5');
    expect(short?.id).toBe('n5');
    if (!full) throw new Error('sign_in not found');
    expect(centerOf(full)).toEqual({ x: 180, y: 524 });
    expect(findByTestId(snapshot.root, 'missing')).toBeUndefined();
  });

  it('never exposes the password value', () => {
    const pw = [...walk(snapshot.root)].find((n) => n.password);
    expect(pw?.value).toBeNull();
    expect(pw?.text).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain('hunter2');
  });
});
