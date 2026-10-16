import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryStore, type Store } from '@/store/store';
import { GET as getFriends, POST as postFriend } from '@/app/api/friends/route';
import { POST as refresh } from '@/app/api/friends/[id]/refresh/route';
import { PUT as putCp } from '@/app/api/friends/[id]/combat-power/route';
import { PUT as putRole } from '@/app/api/friends/[id]/role/route';
import { PUT as putProf } from '@/app/api/friends/[id]/proficiency/route';
import { PUT as putDiff } from '@/app/api/friends/[id]/target-difficulty/route';
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

describe('PUT /api/friends/[id]/proficiency', () => {
  const put = (id: string, body: unknown, password?: string | null) =>
    putProf(req(`/api/friends/${id}/proficiency`, 'PUT', body, password), params(id));
  beforeEach(async () => { await store.saveFriend(friend('a', [ch('A1'), ch('A2')])); });

  it('숙련도를 저장하고(친구 응답의 proficiency) GET /api/friends에도 실린다, null이면 기본값으로', async () => {
    const res = await put('a', { characterName: 'A1', raidName: '세르카', level: '숙련' });
    expect(res.status).toBe(200);
    expect((await res.json()).proficiency).toEqual({ 'A1|세르카': '숙련' });
    expect((await put('a', { characterName: 'A2', raidName: '벨가르딘', level: '클경' })).status).toBe(200);
    const list = await (await getFriends(req('/api/friends'))).json();
    expect(list[0].proficiency).toEqual({ 'A1|세르카': '숙련', 'A2|벨가르딘': '클경' });
    const cleared = await put('a', { characterName: 'A1', raidName: '세르카', level: null });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).proficiency).toEqual({ 'A2|벨가르딘': '클경' });
  });

  it('반숙도 직접 정할 수 있다', async () => {
    const res = await put('a', { characterName: 'A1', raidName: '지평의 성당', level: '반숙' });
    expect((await res.json()).proficiency).toEqual({ 'A1|지평의 성당': '반숙' });
  });

  it('검증 오류: 없는 친구 404, 레이드/숙련도/캐릭터 400, 비밀번호 401', async () => {
    expect((await put('zz', { characterName: 'A1', raidName: '세르카', level: '숙련' })).status).toBe(404);
    const bad = await put('a', { characterName: 'A1', raidName: '없는 레이드', level: '숙련' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: '알 수 없는 레이드예요' });
    expect((await put('a', { characterName: 'A1', raidName: 'serka-hard', level: '숙련' })).status).toBe(400); // id가 아니라 이름
    expect((await put('a', { characterName: 'A1', level: '숙련' })).status).toBe(400);
    expect((await put('a', { characterName: 'A1', raidName: '세르카', level: '고수' })).status).toBe(400);
    expect((await put('a', { characterName: 'A1', raidName: '세르카' })).status).toBe(400);
    expect((await put('a', { raidName: '세르카', level: '숙련' })).status).toBe(400);
    const notMine = await put('a', { characterName: 'Nope', raidName: '세르카', level: '숙련' });
    expect(notMine.status).toBe(400);
    expect(await notMine.json()).toEqual({ error: '이 친구의 캐릭터가 아니에요' });
    expect((await put('a', { characterName: 'A1', raidName: '세르카', level: '숙련' }, 'bad')).status).toBe(401);
    expect((await put('a', { characterName: 'A1', raidName: '세르카', level: '숙련' }, null)).status).toBe(401);
    expect((await store.getFriend('a'))!.proficiency).toBeUndefined();
  });
});

describe('PUT /api/friends/[id]/target-difficulty', () => {
  const ARMOCHE = '카제로스 4막 (아르모체)';
  const put = (id: string, body: unknown, password?: string | null) =>
    putDiff(req(`/api/friends/${id}/target-difficulty`, 'PUT', body, password), params(id));
  const raw = (id: string, text: string) =>
    putDiff(new Request(`http://localhost/api/friends/${id}/target-difficulty`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-app-password': 'secret' }, body: text,
    }), params(id));
  beforeEach(async () => { await store.saveFriend(friend('a', [ch('A1'), ch('A2'), ch('Low', 'dealer', 3000, 1650)])); });

  it('가는 난이도를 저장하고(친구 응답의 targetDifficulty) GET /api/friends에도 실린다, null이면 자동으로', async () => {
    const res = await put('a', { characterName: 'A1', raidName: ARMOCHE, difficulty: '노말' });
    expect(res.status).toBe(200);
    expect((await res.json()).targetDifficulty).toEqual({ [`A1|${ARMOCHE}`]: '노말' });
    expect((await put('a', { characterName: 'A2', raidName: '세르카', difficulty: '안 감' })).status).toBe(200);
    const list = await (await getFriends(req('/api/friends'))).json();
    expect(list[0].targetDifficulty).toEqual({ [`A1|${ARMOCHE}`]: '노말', 'A2|세르카': '안 감' });
    const reset = await put('a', { characterName: 'A1', raidName: ARMOCHE, difficulty: null });
    expect(reset.status).toBe(200);
    expect((await reset.json()).targetDifficulty).toEqual({ 'A2|세르카': '안 감' });
  });

  it('검증 오류: 없는 친구 404(본문보다 먼저), 형식/레이드/난이도/캐릭터 400, 비밀번호 401', async () => {
    expect((await put('zz', { characterName: 'A1', raidName: '세르카', difficulty: '하드' })).status).toBe(404);
    expect((await raw('zz', '{not json')).status).toBe(404);
    expect((await raw('a', '{not json')).status).toBe(400);
    expect((await raw('a', '[1]')).status).toBe(400);
    const badRaid = await put('a', { characterName: 'A1', raidName: '없는 레이드', difficulty: '하드' });
    expect(badRaid.status).toBe(400);
    expect(await badRaid.json()).toEqual({ error: '알 수 없는 레이드예요' });
    expect((await put('a', { characterName: 'A1', raidName: 'serka-hard', difficulty: '하드' })).status).toBe(400);
    const badDiff = await put('a', { characterName: 'A1', raidName: '세르카', difficulty: '3단계' });
    expect(badDiff.status).toBe(400);
    expect((await badDiff.json()).error).toContain('세르카');
    expect((await put('a', { characterName: 'A1', raidName: '세르카' })).status).toBe(400);
    expect((await put('a', { characterName: 'A1', raidName: '세르카', difficulty: 3 })).status).toBe(400);
    expect((await put('a', { raidName: '세르카', difficulty: '하드' })).status).toBe(400);
    const notMine = await put('a', { characterName: 'Nope', raidName: '세르카', difficulty: '하드' });
    expect(notMine.status).toBe(400);
    expect(await notMine.json()).toEqual({ error: '이 친구의 캐릭터가 아니에요' });
    // 1700 미만(화면에 안 보이는) 캐릭터는 어느 화면에서도 고칠 수 없으므로 받지 않는다
    expect((await put('a', { characterName: 'Low', raidName: '세르카', difficulty: '안 감' })).status).toBe(400);
    expect((await put('a', { characterName: 'A1', raidName: '세르카', difficulty: '하드' }, 'bad')).status).toBe(401);
    expect((await put('a', { characterName: 'A1', raidName: '세르카', difficulty: '하드' }, null)).status).toBe(401);
    expect((await store.getFriend('a'))!.targetDifficulty).toBeUndefined();
  });
});

describe('1700 미만 캐릭터는 응답에서 숨긴다 (설계 수정 B)', () => {
  beforeEach(async () => {
    await store.saveFriend(friend('a', [ch('A1'), ch('Low', 'dealer', 3000, 1699.99), ch('Edge', 'support', null, 1700)]));
  });
  it('GET /api/friends의 characters에는 1700 이상만 (저장소에는 남는다)', async () => {
    const list = await (await getFriends(req('/api/friends'))).json();
    expect(list[0].characters.map((c: { name: string }) => c.name)).toEqual(['A1', 'Edge']);
    expect((await store.getFriend('a'))!.characters).toHaveLength(3);
  });
  it('GET /api/friends의 숙련도·가는 난이도도 보이는 캐릭터 것만 (숨긴 캐릭터 값은 저장소에만 남는다)', async () => {
    await store.setProficiency('a', 'A1', '세르카', '숙련');
    await store.setProficiency('a', 'Low', '세르카', '클경');
    await store.setTargetDifficulty('a', 'Edge', '세르카', '노말');
    await store.setTargetDifficulty('a', 'Low', '세르카', '안 감');
    const list = await (await getFriends(req('/api/friends'))).json();
    expect(list[0].proficiency).toEqual({ 'A1|세르카': '숙련' });
    expect(list[0].targetDifficulty).toEqual({ 'Edge|세르카': '노말' });
    const stored = (await store.getFriend('a'))!;
    expect(stored.proficiency).toEqual({ 'A1|세르카': '숙련', 'Low|세르카': '클경' });
    expect(stored.targetDifficulty).toEqual({ 'Edge|세르카': '노말', 'Low|세르카': '안 감' });
  });
  it('수동 전투력/역할/숙련도 응답에도 숨긴 캐릭터가 없고, 숨긴 캐릭터는 고칠 수 없다(400)', async () => {
    const cp = await putCp(req('/api/friends/a/combat-power', 'PUT', { characterName: 'A1', cp: 1 }), params('a'));
    expect((await cp.json()).characters.map((c: { name: string }) => c.name)).toEqual(['A1', 'Edge']);
    expect((await putCp(req('/api/friends/a/combat-power', 'PUT', { characterName: 'Low', cp: 1 }), params('a'))).status).toBe(400);
    expect((await putRole(req('/api/friends/a/role', 'PUT', { characterName: 'Low', role: 'support' }), params('a'))).status).toBe(400);
    expect((await putProf(req('/api/friends/a/proficiency', 'PUT', { characterName: 'Low', raidName: '세르카', level: '숙련' }), params('a'))).status).toBe(400);
  });
});
