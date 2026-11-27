import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { generateToken, waitForReady } from './launcher.js';

describe('generateToken', () => {
  it('returns 32 random bytes as base64url', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });
});

describe('waitForReady', () => {
  it('resolves on the ready line across chunk boundaries and masks the token', async () => {
    const out = new PassThrough();
    const lines: string[] = [];
    const ready = waitForReady(out, 1000, ['SECRET'], (l) => lines.push(l));
    out.write('started with SECRET\nPRISM_AGENT_READY port=71');
    out.write('00 instance=k7q2xm4p protocol=1.0.0\r\n');
    await expect(ready).resolves.toEqual({ port: 7100, instanceId: 'k7q2xm4p', protocol: '1.0.0' });
    expect(lines[0]).toBe('started with ***');
  });

  it('rejects with masked output when the instrumentation exits first', async () => {
    const out = new PassThrough();
    const ready = waitForReady(out, 1000, ['SECRET']);
    out.end('INSTRUMENTATION_RESULT: shortMsg=Process crashed SECRET\n');
    await expect(ready).rejects.toThrow(/exited before it was ready[\s\S]*Process crashed \*\*\*/);
  });

  it('times out', async () => {
    const out = new PassThrough();
    await expect(waitForReady(out, 20)).rejects.toThrow(/within 20 ms/);
  });
});
