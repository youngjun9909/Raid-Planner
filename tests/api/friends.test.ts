import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryStore, type Store } from '@/store/store';
import { GET as getFriends, POST as postFriend } from '@/app/api/friends/route';
import { POST as refresh } from '@/app/api/friends/[id]/refresh/route';
import { PUT as putCp } from '@/app/api/friends/[id]/combat-power/route';
import { LostArkError } from '@/lostark/client';
import { req, ch, friend } from './helpers';

let store: Store;
vi.mock('@/store/store', async (orig) => ({ ...(await orig<typeof import('@/store/store')>()), getStore: () => store }));
const fetchRoster = vi.fn();
vi.mock('@/lostark/client', async (orig) => ({
  ...(await orig<typeof import('@/lostark/client')>()),
  fetchRoster: (...a: unknown[]) => fetchRoster(...a),
}));

beforeEach(() => { process.env.APP_PASSWORD = 'secret'; store = createMemoryStore(); fetchRoster.mockReset(); });
const post = (body: unknown) => postFriend(req('/api/friends', 'POST', body));
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/friends', () => {
  it('로스터를 가져와 저장하고 GET으로 조회된다', async () => {
    fetchRoster.mockResolvedValue([ch('A1')]);
    const res = await post({ displayName: '철수', representativeName: 'A1' });
    expect(res.status).toBe(200);
    const f = await res.json();
    expect(f.id).toBeTruthy();
    expect(f.displayName).toBe('철수');
    expect(fetchRoster).toHaveBeenCalledWith('A1');
    expect(await (await getFriends(req('/api/friends'))).json()).toEqual([f]);
  });
  it('빈 입력은 400', async () => {
    expect((await post({ displayName: '', representativeName: 'A1' })).status).toBe(400);
    expect((await post({ displayName: 'x' })).status).toBe(400);
    expect(fetchRoster).not.toHaveBeenCalled();
  });
  it('not_found면 404와 "캐릭터를 찾을 수 없어요"', async () => {
    fetchRoster.mockRejectedValue(new LostArkError('not_found'));
    const res = await post({ displayName: 'x', representativeName: 'y' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '캐릭터를 찾을 수 없어요' });
  });
  it.each([
    ['rate_limited', 429],
    ['unauthorized', 502],
    ['unknown', 502],
  ] as const)('LostArkError %s -> %i', async (code, status) => {
    fetchRoster.mockRejectedValue(new LostArkError(code));
    const res = await post({ displayName: 'x', representativeName: 'y' });
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(new LostArkError(code).message);
  });
});

describe('POST /api/friends/[id]/refresh', () => {
  it('로스터를 다시 가져오되 수동 CP와 discordUserId를 유지한다', async () => {
    await store.saveFriend({ ...friend('a', [ch('A1', 'dealer', 1000)]), discordUserId: 'd1' });
    await store.setManualCombatPower('a', 'A1', 4321);
    fetchRoster.mockResolvedValue([ch('A1', 'dealer', 1111), ch('A2')]);
    const res = await refresh(req('/api/friends/a/refresh', 'POST'), params('a'));
    expect(res.status).toBe(200);
    const f = await res.json();
    expect(f.discordUserId).toBe('d1');
    expect(f.characters.map((c: { name: string }) => c.name)).toEqual(['A1', 'A2']);
    expect(f.characters[0].combatPower).toBe(4321);
    expect(fetchRoster).toHaveBeenCalledWith('A1');
  });
  it('없는 친구는 404, 비밀번호 오류는 401, API 오류는 매핑', async () => {
    expect((await refresh(req('/x', 'POST'), params('zz'))).status).toBe(404);
    expect((await refresh(req('/x', 'POST', undefined, 'bad'), params('zz'))).status).toBe(401);
    await store.saveFriend(friend('a', [ch('A1')]));
    fetchRoster.mockRejectedValue(new LostArkError('rate_limited'));
    expect((await refresh(req('/x', 'POST'), params('a'))).status).toBe(429);
  });
});

describe('PUT /api/friends/[id]/combat-power', () => {
  const put = (id: string, body: unknown) => putCp(req(`/api/friends/${id}/combat-power`, 'PUT', body), params(id));
  beforeEach(async () => { await store.saveFriend(friend('a', [ch('A1', 'dealer', 1000)])); });
  it('수동 CP를 저장하고 null로 해제한다', async () => {
    expect((await put('a', { characterName: 'A1', cp: 2500 })).status).toBe(200);
    expect((await store.getFriend('a'))!.characters[0].combatPower).toBe(2500);
    expect((await put('a', { characterName: 'A1', cp: null })).status).toBe(200);
    expect((await store.getFriend('a'))!.characters[0].combatPower).toBe(1000);
  });
  it('검증 오류', async () => {
    expect((await put('zz', { characterName: 'A1', cp: 1 })).status).toBe(404);
    expect((await put('a', { characterName: 'A1', cp: -1 })).status).toBe(400);
    expect((await put('a', { characterName: 'A1', cp: 'x' })).status).toBe(400);
    expect((await put('a', { characterName: 'A1' })).status).toBe(400);
    expect((await put('a', { characterName: 'Nope', cp: 1 })).status).toBe(400);
  });
});
