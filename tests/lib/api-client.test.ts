import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api-client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function mockFetch(res: Response | (() => Promise<Response>)) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(typeof res === 'function' ? res : async () => res);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('api-client', () => {
  it('sends the password header and parses JSON', async () => {
    const fetch = mockFetch(json([]));
    await expect(api.listFriends('pw')).resolves.toEqual([]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/friends');
    expect((init.headers as Record<string, string>)['x-app-password']).toBe('pw');
  });

  it('PUTs clears with the full record set', async () => {
    const fetch = mockFetch(json({ ok: true }));
    await api.putClears('pw', '가나', [{ raidName: '세르카', difficulty: '하드' }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/clears');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ characterName: '가나', records: [{ raidName: '세르카', difficulty: '하드' }] });
  });

  it('encodes the friend id in combat-power and refresh URLs', async () => {
    const fetch = mockFetch(json({}));
    await api.setCombatPower('pw', 'a/b', '가나', 2500);
    await api.refreshFriend('pw', 'a/b');
    expect(fetch.mock.calls[0][0]).toBe('/api/friends/a%2Fb/combat-power');
    expect(fetch.mock.calls[1][0]).toBe('/api/friends/a%2Fb/refresh');
  });

  it('PUTs proficiency with characterName, raidName, level (null = 기본값)', async () => {
    const fetch = mockFetch(json({}));
    await api.setProficiency('pw', 'a/b', '가나', '세르카', '숙련');
    await api.setProficiency('pw', 'a/b', '가나', '세르카', null);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/friends/a%2Fb/proficiency');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ characterName: '가나', raidName: '세르카', level: '숙련' });
    expect(JSON.parse((fetch.mock.calls[1][1] as RequestInit).body as string)).toEqual({ characterName: '가나', raidName: '세르카', level: null });
  });

  it('throws ApiError carrying the Korean server message and status', async () => {
    mockFetch(json({ error: '비밀번호가 올바르지 않아요' }, 401));
    const err = await api.listFriends('x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('비밀번호가 올바르지 않아요');
  });

  it('turns network failures into a friendly ApiError', async () => {
    mockFetch(async () => { throw new TypeError('Failed to fetch'); });
    const err = await api.getClears('pw').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/서버에 연결할 수 없어요/);
  });
});
