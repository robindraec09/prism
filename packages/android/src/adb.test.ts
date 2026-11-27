import { describe, expect, it } from 'vitest';
import {
  Adb,
  buildInstrumentArgs,
  maskSecrets,
  parseDevices,
  parseForwardPort,
  parseReadyLine,
  resolveAdbPath,
} from './adb.js';

const token = 'Zm9vYmFyYmF6cXV4MDEyMzQ1Njc4OWFiY2RlZmdoaWo';

describe('buildInstrumentArgs', () => {
  it('builds the protocol §4.3 command', () => {
    expect(buildInstrumentArgs({ token })).toEqual([
      'shell',
      'am',
      'instrument',
      '-w',
      '-e',
      'prismPort',
      '7100',
      '-e',
      'prismToken',
      token,
      'io.prismtest.agent.test/androidx.test.runner.AndroidJUnitRunner',
    ]);
  });

  it('passes a custom port and idle timeout', () => {
    const args = buildInstrumentArgs({ token, devicePort: 7200, idleTimeoutMs: 60000 });
    expect(args.slice(4, 9)).toEqual(['-e', 'prismPort', '7200', '-e', 'prismIdleTimeoutMs']);
    expect(args[9]).toBe('60000');
  });

  it('rejects tokens that are short or could inject shell syntax', () => {
    expect(() => buildInstrumentArgs({ token: 'short' })).toThrow(/32 base64url/);
    expect(() => buildInstrumentArgs({ token: `${token};reboot` })).toThrow(/base64url/);
    expect(() => buildInstrumentArgs({ token: `${token} x` })).toThrow(/base64url/);
  });

  it('rejects bad ports', () => {
    expect(() => buildInstrumentArgs({ token, devicePort: 0 })).toThrow(/port/);
    expect(() => buildInstrumentArgs({ token, devicePort: 70000 })).toThrow(/port/);
  });
});

describe('parseReadyLine', () => {
  it('reads the plain and the -r forms', () => {
    const expected = { port: 7100, instanceId: 'k7q2xm4p', protocol: '1.0.0' };
    expect(parseReadyLine('PRISM_AGENT_READY port=7100 instance=k7q2xm4p protocol=1.0.0')).toEqual(
      expected,
    );
    expect(
      parseReadyLine(
        'INSTRUMENTATION_STATUS: stream=PRISM_AGENT_READY port=7100 instance=k7q2xm4p protocol=1.0.0',
      ),
    ).toEqual(expected);
  });

  it('ignores other output and malformed instance IDs', () => {
    expect(parseReadyLine('INSTRUMENTATION_STATUS_CODE: 1')).toBeUndefined();
    expect(
      parseReadyLine('PRISM_AGENT_READY port=7100 instance=K7Q2XM4P protocol=1.0.0'),
    ).toBeUndefined();
  });
});

describe('parseDevices', () => {
  it('parses adb devices -l', () => {
    const out = [
      '* daemon started successfully',
      'List of devices attached',
      'emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 transport_id:1',
      '192.168.1.20:5555      unauthorized transport_id:2',
      '',
    ].join('\r\n');
    expect(parseDevices(out)).toEqual([
      {
        serial: 'emulator-5554',
        state: 'device',
        props: { product: 'sdk_gphone64_x86_64', model: 'sdk_gphone64_x86_64', transport_id: '1' },
      },
      { serial: '192.168.1.20:5555', state: 'unauthorized', props: { transport_id: '2' } },
    ]);
  });
});

describe('parseForwardPort', () => {
  it('reads the port adb picked', () => {
    expect(parseForwardPort('52817\n')).toBe(52817);
  });

  it('rejects anything else', () => {
    expect(() => parseForwardPort('error: device offline')).toThrow(/adb forward/);
    expect(() => parseForwardPort('99999')).toThrow(/adb forward/);
  });
});

describe('maskSecrets', () => {
  it('masks every occurrence', () => {
    expect(maskSecrets(`a ${token} b ${token}`, [token])).toBe('a *** b ***');
    expect(maskSecrets('nothing', ['', token])).toBe('nothing');
  });
});

describe('Adb', () => {
  it('prefixes the serial', () => {
    expect(new Adb({ adbPath: 'adb', serial: 'emulator-5554' }).argsFor(['devices'])).toEqual([
      '-s',
      'emulator-5554',
      'devices',
    ]);
    expect(new Adb({ adbPath: 'adb' }).argsFor(['devices'])).toEqual(['devices']);
  });

  it('masks the token in errors', async () => {
    const adb = new Adb({ adbPath: process.execPath, secrets: [token] });
    // `node -e <script> <token>` exits non-zero and echoes the token to stderr.
    await expect(
      adb.run(['-e', 'process.stderr.write(process.argv[1]); process.exit(3)', token]),
    ).rejects.toThrow(/^(?!.*Zm9vYmFy).*\*\*\*/s);
  });

  it('resolves adb from ANDROID_HOME', () => {
    expect(resolveAdbPath({ ANDROID_HOME: '/sdk' })).toMatch(
      /[\\/]sdk[\\/]platform-tools[\\/]adb(\.exe)?$/,
    );
    expect(resolveAdbPath({})).toMatch(/^adb(\.exe)?$/);
  });
});
