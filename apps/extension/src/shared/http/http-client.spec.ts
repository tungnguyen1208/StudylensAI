import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './http-client';

describe('HttpClient bearer ownership', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds the in-memory access token and removes it after sign-out', async () => {
    const fetchMock = vi.fn()
      .mockImplementation(async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('http://127.0.0.1:5000');

    client.setAccessToken('access-token-kept-by-service-worker');
    await client.get('api/account');
    client.setAccessToken(null);
    await client.get('api/health/live');

    const authenticatedHeaders = new Headers(fetchMock.mock.calls[0][1].headers);
    const signedOutHeaders = new Headers(fetchMock.mock.calls[1][1].headers);
    expect(authenticatedHeaders.get('Authorization')).toBe('Bearer access-token-kept-by-service-worker');
    expect(signedOutHeaders.has('Authorization')).toBe(false);
  });

  it('does not let a caller override the service-worker bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('http://127.0.0.1:5000');
    client.setAccessToken('trusted-token');

    await client.get('api/account', { headers: { Authorization: 'Bearer untrusted-token' } });

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get('Authorization')).toBe('Bearer trusted-token');
  });
});
