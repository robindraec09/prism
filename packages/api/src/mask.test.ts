import { describe, expect, it } from 'vitest';

import { MASK, maskHeaders, maskUrl, serializeRequest } from './index.js';

describe('maskHeaders', () => {
  it('masks credentials and keeps the authorization scheme', () => {
    expect(
      maskHeaders({
        Authorization: 'Bearer eyJhbGciOi.payload.sig',
        'Proxy-Authorization': 'Basic dXNlcjpwYXNz',
        Cookie: 'sid=1',
        'Set-Cookie': ['a=1', 'b=2'],
        'X-API-Key': 'k',
        Accept: 'application/json',
      }),
    ).toEqual({
      authorization: 'Bearer ***',
      'proxy-authorization': 'Basic ***',
      cookie: MASK,
      'set-cookie': MASK,
      'x-api-key': MASK,
      accept: 'application/json',
    });
  });

  it('masks a bare authorization value completely', () => {
    expect(maskHeaders({ authorization: 'opaque-token' })).toEqual({ authorization: MASK });
  });

  it('masks header names that look secret', () => {
    expect(
      maskHeaders({
        'X-Refresh-Token': 't',
        'X-Client-Secret': 's',
        'X-Session-Id': 'i',
        'X-Signature': 'g',
        'X-Request-Id': 'r',
      }),
    ).toEqual({
      'x-refresh-token': MASK,
      'x-client-secret': MASK,
      'x-session-id': MASK,
      'x-signature': MASK,
      'x-request-id': 'r',
    });
  });

  it('masks extra names and skips undefined values', () => {
    expect(maskHeaders({ 'x-tenant': 'acme', gone: undefined }, new Set(['x-tenant']))).toEqual({
      'x-tenant': MASK,
    });
  });
});

describe('maskUrl', () => {
  it('masks the password and secret query values, keeping the rest', () => {
    expect(maskUrl('https://bob:hunter2@api.test/v1?api_key=abc&page=2&access_token=t')).toBe(
      'https://bob:***@api.test/v1?api_key=***&page=2&access_token=***',
    );
  });

  it('masks every value of a repeated secret parameter', () => {
    expect(maskUrl('http://h/?token=a&token=b')).toBe('http://h/?token=***&token=***');
  });

  it('returns URLs without secrets unchanged', () => {
    expect(maskUrl('http://h/path?q=a%20b')).toBe('http://h/path?q=a%20b');
    expect(maskUrl(new URL('http://h/'))).toBe('http://h/');
  });
});

describe('serializeRequest', () => {
  it('masks headers and URL and leaves out the body', () => {
    const out = serializeRequest({
      method: 'POST',
      url: new URL('http://h/login?password=pw'),
      headers: { authorization: 'Bearer x' },
      name: 'login',
    });
    expect(out).toEqual({
      method: 'POST',
      url: 'http://h/login?password=***',
      headers: { authorization: 'Bearer ***' },
      name: 'login',
    });
  });
});
