import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryStore, type Store } from '@/store/store';
import { GET as getClears, PUT as putClears } from '@/app/api/clears/route';
import { POST as postPlan } from '@/app/api/plan/route';
import { req, ch, friend } from './helpers';

let store: Store;
vi.mock('@/store/store', async (orig) => ({ ...(await orig<typeof import('@/store/store')>()), getStore: () => store }));

beforeEach(async () => {
  process.env.APP_PASSWORD = 'secret';
  store = createMemoryStore();
  await store.saveFriend(friend('a', [ch('A1')]));
  await store.saveFriend(friend('b', [ch('B1')]));
});

const plan = (body: unknown) => postPlan(req('/api/plan', 'POST', body));

describe('POST /api/plan', () => {
  it('raidId와 참석자로 후보를 돌려준다', async () => {
    const res = await plan({ raidId: 'serka-normal', attendeeIds: ['a', 'b'] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.raid.id).toBe('serka-normal');
    expect(json.candidates.length).toBeGreaterThan(0);
    expect(json.excluded).toEqual([]);
  });
  it('저장된 숙련도(그 레이드 이름)를 편성에 넘긴다: 친구 자리와 공대 요약에 숙련도가 실린다', async () => {
    await store.setProficiency('a', 'A1', '세르카', '숙련');
    await store.setProficiency('b', 'B1', '벨가르딘', '클경'); // 다른 레이드 값은 쓰지 않는다
    const json = await (await plan({ raidId: 'serka-normal', attendeeIds: ['a', 'b'] })).json();
    const party = json.candidates[0].parties[0];
    const profs = Object.fromEntries(party.slots.filter((s: { kind: string }) => s.kind === 'friend')
      .map((s: { character: { name: string }; proficiency: string }) => [s.character.name, s.proficiency]));
    expect(profs).toEqual({ A1: '숙련', B1: '반숙' });
    expect(party.proficiency).toEqual({ 숙련: 1, 반숙: 1, 클경: 0, noExpert: false });
    expect(json.proficiencyTracked).toBe(true);
  });
  it('proficiencyTracked: 아무것도 정하지 않았거나 다른 레이드에만 정했으면 false, 반숙을 직접 정해도 true', async () => {
    const tracked = async () => (await (await plan({ raidId: 'serka-normal', attendeeIds: ['a', 'b'] })).json()).proficiencyTracked;
    expect(await tracked()).toBe(false);
    await store.setProficiency('a', 'A1', '벨가르딘', '숙련');
    expect(await tracked()).toBe(false);
    await store.setProficiency('b', 'B1', '세르카', '반숙');
    expect(await tracked()).toBe(true);
  });
  it('알 수 없는 raidId는 400', async () => {
    const res = await plan({ raidId: 'nope', attendeeIds: ['a'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '알 수 없는 레이드예요' });
  });
  it('attendeeIds가 배열이 아니면 400', async () => {
    expect((await plan({ raidId: 'serka-normal' })).status).toBe(400);
    expect((await plan({ raidId: 'serka-normal', attendeeIds: 'a' })).status).toBe(400);
  });
});

describe('PUT /api/clears', () => {
  const put = (body: unknown) => putClears(req('/api/clears', 'PUT', body));
  it('저장 후 GET으로 이번 주 기록을 돌려준다', async () => {
    const res = await put({ characterName: 'A1', records: [{ raidName: '세르카', difficulty: '노말' }] });
    expect(res.status).toBe(200);
    const got = await (await getClears(req('/api/clears'))).json();
    expect(got).toEqual([{ characterName: 'A1', raidName: '세르카', difficulty: '노말' }]);
  });
  it('같은 레이드 두 난이도는 400', async () => {
    const res = await put({ characterName: 'A1', records: [{ raidName: '세르카', difficulty: '노말' }, { raidName: '세르카', difficulty: '하드' }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '한 레이드는 한 난이도만 선택할 수 있어요' });
  });
  it('존재하지 않는 레이드/난이도, 빈 이름은 400', async () => {
    expect((await put({ characterName: 'A1', records: [{ raidName: '세르카', difficulty: '없음' }] })).status).toBe(400);
    expect((await put({ characterName: '', records: [] })).status).toBe(400);
    expect((await put({ characterName: 'A1', records: [{ raidName: '', difficulty: '' }] })).status).toBe(400);
    expect((await put({ characterName: 'A1' })).status).toBe(400);
  });
  it('PUT 후 plan에서 그 캐릭터가 빠진다', async () => {
    await put({ characterName: 'A1', records: [{ raidName: '세르카', difficulty: '노말' }] });
    const json = await (await plan({ raidId: 'serka-normal', attendeeIds: ['a', 'b'] })).json();
    expect(json.excluded).toEqual([{ friendId: 'a', reason: '가능한 캐릭터 없음' }]);
  });
});
