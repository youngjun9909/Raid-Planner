import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryStore, type Store } from '@/store/store';
import { GET as getFriends, POST as postFriend } from '@/app/api/friends/route';
import { POST as refresh } from '@/app/api/friends/[id]/refresh/route';
import { PUT as putCp } from '@/app/api/friends/[id]/combat-power/route';
import { PUT as putRole } from '@/app/api/friends/[id]/role/route';
import { DELETE as deleteFriend } from '@/app/api/friends/[id]/route';
import { weekKey } from '@/core/week';
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
  it('이미 있는 대표 캐릭터면 로스터를 부르지 않고 409', async () => {
    await store.saveFriend(friend('a', [ch('A1'), ch('A2')]));
    for (const rep of ['A1', ' A1 ', 'A2']) {
      const res = await post({ displayName: '중복', representativeName: rep });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: '이미 등록된 캐릭터예요' });
    }
    expect(fetchRoster).not.toHaveBeenCalled();
    expect(await store.listFriends()).toHaveLength(1);
  });
  it('불러온 원정대에 다른 친구의 캐릭터가 있으면 409 (저장하지 않음)', async () => {
    await store.saveFriend(friend('a', [ch('A1'), ch('A2')]));
    fetchRoster.mockResolvedValue([ch('Z1'), ch('A2')]);
    const res = await post({ displayName: '부캐', representativeName: 'Z1' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: '이미 등록된 캐릭터예요' });
    expect(await store.listFriends()).toHaveLength(1);
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

describe('DELETE /api/friends/[id]', () => {
  const del = (id: string, password?: string | null) => deleteFriend(req(`/api/friends/${id}`, 'DELETE', undefined, password), params(id));
  it('친구와 이번 주 그 친구 캐릭터의 클리어를 지운다', async () => {
    const week = weekKey(new Date());
    await store.saveFriend(friend('a', [ch('A1'), ch('A2')]));
    await store.saveFriend(friend('b', [ch('B1')]));
    await store.setManualCombatPower('a', 'A1', 1);
    await store.setCharacterClears(week, 'A1', [{ raidName: '세르카', difficulty: '하드' }]);
    await store.setCharacterClears(week, 'B1', [{ raidName: '세르카', difficulty: '하드' }]);
    const res = await del('a');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await store.listFriends()).map((f) => f.id)).toEqual(['b']);
    expect((await store.getClears(week)).map((c) => c.characterName)).toEqual(['B1']);
  });
  it('없는 친구는 404, 비밀번호 오류는 401', async () => {
    expect((await del('zz')).status).toBe(404);
    await store.saveFriend(friend('a', [ch('A1')]));
    expect((await del('a', 'bad')).status).toBe(401);
    expect(await store.listFriends()).toHaveLength(1);
  });
});

describe('PUT /api/friends/[id]/role', () => {
  const put = (id: string, body: unknown) => putRole(req(`/api/friends/${id}/role`, 'PUT', body), params(id));
  beforeEach(async () => { await store.saveFriend(friend('a', [ch('A1', 'dealer', 1000)])); });
  it('수동 역할을 저장하고(수동 표시) null로 자동으로 되돌린다', async () => {
    const res = await put('a', { characterName: 'A1', role: 'support' });
    expect(res.status).toBe(200);
    expect((await res.json()).characters[0]).toMatchObject({ role: 'support', manualRole: true });
    expect((await store.getFriend('a'))!.characters[0].role).toBe('support');
    expect((await put('a', { characterName: 'A1', role: null })).status).toBe(200);
    expect((await store.getFriend('a'))!.characters[0]).toMatchObject({ role: 'dealer' });
    expect((await store.getFriend('a'))!.characters[0].manualRole).toBeUndefined();
  });
  it('검증 오류', async () => {
    expect((await put('zz', { characterName: 'A1', role: 'support' })).status).toBe(404);
    expect((await put('a', { characterName: 'A1', role: 'tank' })).status).toBe(400);
    expect((await put('a', { characterName: 'A1' })).status).toBe(400);
    expect((await put('a', { role: 'support' })).status).toBe(400);
    expect((await put('a', { characterName: 'Nope', role: 'support' })).status).toBe(400);
    expect((await putRole(req('/x', 'PUT', { characterName: 'A1', role: 'support' }, 'bad'), params('a'))).status).toBe(401);
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
