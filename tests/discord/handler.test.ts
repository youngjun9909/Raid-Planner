import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryStore, type Store } from '@/store/store';
import { handleInteraction, type Deps } from '@/discord/handler';
import { COMMANDS, registrationPayload } from '@/discord/commands';
import { LostArkError } from '@/lostark/client';
import { RAIDS } from '@/core/raids';
import { weekKey } from '@/core/week';
import type { Character, Friend } from '@/core/types';
import { getWebUrl } from '@/lib/web-url';
import type { StringSelect } from '@/discord/types';

const NOW = new Date('2026-10-16T03:00:00Z');
const WEEK = weekKey(NOW);
// 기본 1735: 세르카의 자동 가는 난이도가 하드라서 /공대 세르카 하드 후보가 된다 (설계 수정 2026-10-16 A)
const ch = (name: string, role: 'dealer' | 'support' = 'dealer', cp: number | null = 3800, itemLevel = 1735): Character =>
  ({ name, className: '버서커', role, itemLevel, combatPower: cp });

let store: Store;
let deps: Deps;
let fetchRoster: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = createMemoryStore();
  fetchRoster = vi.fn();
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  deps = { store, fetchRoster: fetchRoster as unknown as Deps['fetchRoster'], now: () => NOW, fetch: fetchMock as unknown as typeof fetch };
});

const user = (id: string, name = '철수') => ({ member: { user: { id, username: `user${id}`, global_name: name } } });
const cmd = (name: string, options: { name: string; value: unknown }[] = [], userId = 'u1') =>
  ({ type: 2, id: 'i1', application_id: 'app1', token: 'tok-secret', ...user(userId), data: { name, options: options.map((o) => ({ ...o, type: 3 })) } });
const comp = (customId: string, values: string[], userId = 'u1') =>
  ({ type: 3, id: 'i2', application_id: 'app1', token: 'tok-secret', ...user(userId), data: { custom_id: customId, component_type: 3, values } });

const friendA: Friend = { id: 'fa', displayName: '철수', discordUserId: 'u1', representativeName: 'A1', characters: [ch('A1'), ch('A2-sup', 'support', 2500)] };
const friendB: Friend = { id: 'fb', displayName: '영희', discordUserId: 'u2', representativeName: 'B1', characters: [ch('B1'), ch('B2', 'support', 2600)] };

async function run(body: unknown) {
  return handleInteraction(body as never, deps);
}
const content = (r: { response: any }) => r.response.data?.content as string;
/** 임베드까지 포함한 메시지 전체 텍스트. */
const all = (r: { response: any }) => JSON.stringify(r.response.data);

describe('COMMANDS', () => {
  it('명령어, 등록, 공대, 클리어, 현황, 웹, 숙련도, 난이도', () => {
    expect(COMMANDS.map((c) => c.name).sort()).toEqual(['공대', '등록', '명령어', '클리어', '현황', '웹', '숙련도', '난이도'].sort());
  });
  it('/숙련도: 캐릭터(자동완성), 레이드(레이드 이름 6개), 숙련도(숙련/반숙/클경) 옵션이 모두 필수', () => {
    const c = COMMANDS.find((x) => x.name === '숙련도')!;
    expect(c.options!.map((o) => [o.name, o.type, o.required])).toEqual([['캐릭터', 3, true], ['레이드', 3, true], ['숙련도', 3, true]]);
    expect(c.options![0].autocomplete).toBe(true);
    expect(c.options![0].choices).toBeUndefined();
    expect(c.options![1].choices!.map((x) => x.value)).toEqual([...new Set(RAIDS.map((r) => r.name))]);
    expect(c.options![1].choices!.length).toBeLessThanOrEqual(25);
    expect(c.options![2].choices!.map((x) => x.value)).toEqual(['숙련', '반숙', '클경']);
    const reg = registrationPayload().find((x) => x.name === '숙련도')!;
    expect(reg.options![0]).toMatchObject({ name: '캐릭터', autocomplete: true });
    expect(reg).not.toHaveProperty('group');
  });
  it('모든 COMMANDS에 비어 있지 않은 한글 description이 있다', () => {
    const hangul = /[가-힣]/;
    for (const c of COMMANDS) {
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(100);
      expect(c.description).toMatch(hangul);
      expect(c.name.length).toBeLessThanOrEqual(32);
      for (const o of c.options ?? []) {
        expect(o.description.length).toBeGreaterThan(0);
        expect(o.description.length).toBeLessThanOrEqual(100);
        expect(o.description).toMatch(hangul);
        for (const choice of o.choices ?? []) expect(choice.name.length).toBeLessThanOrEqual(100);
      }
    }
  });
  it('/공대의 레이드 선택지는 14개 레이드 (값 = id, 이름 = "이름 난이도")', () => {
    const opt = COMMANDS.find((c) => c.name === '공대')!.options![0];
    expect(opt.choices).toHaveLength(14);
    expect(opt.choices!.map((c) => c.value)).toEqual(RAIDS.map((r) => r.id));
    expect(opt.choices![0].name).toBe(`${RAIDS[0].name} ${RAIDS[0].difficulty}`);
  });
});

describe('handleInteraction', () => {
  it('PING → PONG', async () => {
    expect((await run({ type: 1 })).response).toEqual({ type: 1 });
  });

  it('/명령어는 ephemeral이고 모든 COMMANDS 이름을 포함한다', async () => {
    const r = await run(cmd('명령어'));
    expect(r.response.type).toBe(4);
    expect(r.response.data!.flags).toBe(64);
    expect(r.response.data!.embeds).toHaveLength(1);
    for (const c of COMMANDS) {
      expect(all(r)).toContain(`/${c.name}`);
      expect(all(r)).toContain(c.description);
    }
  });

  describe('/웹', () => {
    it('본인에게만 보이는 링크 버튼 하나를 돌려준다 (custom_id 없음, 주소는 getWebUrl)', async () => {
      const r = await run(cmd('웹'));
      expect(r.response.type).toBe(4);
      expect(r.response.data!.flags).toBe(64);
      expect(r.response.data!.embeds).toHaveLength(1);
      expect(r.response.data!.embeds![0].title).toContain('웹으로 열기');
      const rows = r.response.data!.components!;
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe(1);
      expect(rows[0].components).toHaveLength(1);
      const button = rows[0].components[0] as unknown as Record<string, unknown>;
      expect(button).toEqual({ type: 2, style: 5, label: '🌐 웹으로 열기', url: getWebUrl() });
      expect('custom_id' in button).toBe(false);
    });
    it('저장소를 읽지 않고, 주소에 비밀번호/토큰이 없다', async () => {
      const spy = vi.spyOn(store, 'listFriends');
      const r = await run(cmd('웹'));
      expect(spy).not.toHaveBeenCalled();
      expect(all(r)).not.toMatch(/password|token|tok-secret/i);
    });
    it('/명령어 목록에 /웹이 나온다', async () => {
      expect(all(await run(cmd('명령어')))).toContain('/웹');
    });
    it('링크 버튼에서 잘못 들어온 컴포넌트 요청도 오류 없이 안내로 거절한다', async () => {
      const r = await run({ type: 3, token: 't', ...user('u1'), data: { component_type: 2 } });
      expect(r.response.type).toBe(4);
      expect(r.response.data!.flags).toBe(64);
    });
  });

  describe('/등록', () => {
    it('/등록은 본인에게만 보이는 type 5로 먼저 응답한다 (거절 안내가 공개되지 않게)', async () => {
      fetchRoster.mockResolvedValue([ch('X1')]);
      const r = await run(cmd('등록', [{ name: '대표캐릭터', value: 'X1' }]));
      expect(r.response).toEqual({ type: 5, data: { flags: 64 } });
      expect(fetchRoster).not.toHaveBeenCalled();
      expect(r.after).toBeTypeOf('function');
    });

    it('after()가 로스터를 가져와 새 친구를 만들고 discordUserId를 연결해 결과를 PATCH한다', async () => {
      fetchRoster.mockResolvedValue([ch('X1'), ch('X2')]);
      const r = await run(cmd('등록', [{ name: '대표캐릭터', value: ' X1 ' }], 'u9'));
      await r.after!();
      expect(fetchRoster).toHaveBeenCalledWith('X1');
      const friends = await store.listFriends();
      expect(friends).toHaveLength(1);
      expect(friends[0]).toMatchObject({ displayName: '철수', discordUserId: 'u9', representativeName: 'X1' });
      expect(friends[0].characters.map((c) => c.name)).toEqual(['X1', 'X2']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/webhooks/app1/tok-secret/messages/@original');
      expect(init.method).toBe('PATCH');
      const body = JSON.parse(init.body);
      expect(body.content).toContain('등록 완료');
      expect(body.embeds[0].color).toBe(0x57f287);
      expect(body.embeds[0].description).toContain('X1 원정대 캐릭터 2개');
      expect(init.body).not.toContain('tok-secret');
    });

    it('같은 대표 캐릭터의 친구(디스코드 미연결)가 있으면 새로 만들지 않고 연결한다', async () => {
      await store.saveFriend({ id: 'web', displayName: '웹철수', representativeName: 'X1', characters: [ch('X1')] });
      fetchRoster.mockResolvedValue([ch('X1'), ch('X3')]);
      await (await run(cmd('등록', [{ name: '대표캐릭터', value: 'X1' }], 'u9'))).after!();
      const friends = await store.listFriends();
      expect(friends).toHaveLength(1);
      expect(friends[0]).toMatchObject({ id: 'web', displayName: '웹철수', discordUserId: 'u9' });
      expect(friends[0].characters.map((c) => c.name)).toEqual(['X1', 'X3']);
    });

    it('이미 연결된 디스코드 사용자는 그 친구를 갱신한다 (대표 캐릭터 변경)', async () => {
      await store.saveFriend(friendA);
      fetchRoster.mockResolvedValue([ch('NEW1')]);
      await (await run(cmd('등록', [{ name: '대표캐릭터', value: 'NEW1' }], 'u1'))).after!();
      const friends = await store.listFriends();
      expect(friends).toHaveLength(1);
      expect(friends[0]).toMatchObject({ id: 'fa', representativeName: 'NEW1', discordUserId: 'u1' });
    });

    it('다른 디스코드 계정에 연결된 대표 캐릭터는 중복으로 만들지 않는다', async () => {
      await store.saveFriend(friendB);
      fetchRoster.mockResolvedValue([ch('B1')]);
      await (await run(cmd('등록', [{ name: '대표캐릭터', value: 'B1' }], 'u9'))).after!();
      expect(await store.listFriends()).toHaveLength(1);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).content).toContain('다른 디스코드 계정');
    });

    it('내 친구를 갱신하더라도 다른 친구의 캐릭터가 섞인 원정대는 거절한다', async () => {
      await store.saveFriend(friendA);
      await store.saveFriend({ ...friendB, discordUserId: undefined });
      fetchRoster.mockResolvedValue([ch('NEW1'), ch('B2', 'support')]);
      await (await run(cmd('등록', [{ name: '대표캐릭터', value: 'NEW1' }], 'u1'))).after!();
      expect((await store.getFriend('fa'))!.representativeName).toBe('A1');
      expect(await store.listFriends()).toHaveLength(2);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toContain('이미 다른 친구(영희)로 등록된 캐릭터');
      expect(body.embeds[0].color).toBe(0xed4245);
    });

    it('다른 친구(디스코드 미연결)의 캐릭터 이름이면 로스터를 부르지 않고 거절한다 (이미 내 친구가 있을 때)', async () => {
      await store.saveFriend(friendA);
      await store.saveFriend({ id: 'web', displayName: '웹민수', representativeName: 'W1', characters: [ch('W1')] });
      await (await run(cmd('등록', [{ name: '대표캐릭터', value: 'W1' }], 'u1'))).after!();
      expect(fetchRoster).not.toHaveBeenCalled();
      expect((await store.getFriend('fa'))!.representativeName).toBe('A1');
      expect((await store.getFriend('web'))!.discordUserId).toBeUndefined();
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).content).toContain('이미 다른 친구(웹민수)로 등록된 캐릭터');
    });

    it('/등록에서 not_found면 "캐릭터를 찾을 수 없어요" 메시지', async () => {
      fetchRoster.mockRejectedValue(new LostArkError('not_found'));
      await (await run(cmd('등록', [{ name: '대표캐릭터', value: 'nobody' }]))).after!();
      expect(await store.listFriends()).toHaveLength(0);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toContain('캐릭터를 찾을 수 없어요');
      expect(body.embeds[0].color).toBe(0xed4245);
      expect(body.embeds[0].fields[0].name).toBe('해결 방법');
    });

    it('예상 못 한 오류도 후속 메시지로 알린다', async () => {
      fetchRoster.mockRejectedValue(new Error('boom secret detail'));
      await (await run(cmd('등록', [{ name: '대표캐릭터', value: 'x' }]))).after!();
      const text = JSON.parse(fetchMock.mock.calls[0][1].body).content;
      expect(text).toContain('문제가 생겼어요');
      expect(text).not.toContain('secret');
    });
  });

  describe('/공대', () => {
    it('등록된 친구가 없으면 안내', async () => {
      const r = await run(cmd('공대', [{ name: '레이드', value: 'serka-hard' }]));
      expect(r.response.type).toBe(4);
      expect(content(r)).toContain('/등록');
    });

    it('/공대는 후보가 없으면 사유를 문장으로 알려준다', async () => {
      await store.saveFriend({ ...friendA, characters: [ch('A-low', 'dealer', 3000, 1600)] });
      const r = await run(cmd('공대', [{ name: '레이드', value: 'serka-hard' }]));
      expect(all(r)).toContain('참석할 수 있는 캐릭터가 없어요');
    });

    it('알 수 없는 레이드 id', async () => {
      await store.saveFriend(friendA);
      const r = await run(cmd('공대', [{ name: '레이드', value: 'nope' }]));
      expect(r.response.data!.flags).toBe(64);
      expect(content(r)).toContain('알 수 없는');
    });
  });

  describe('/클리어', () => {
    beforeEach(async () => { await store.saveFriend(friendA); await store.saveFriend(friendB); });

    it('등록 안 한 사용자는 /등록 안내 (ephemeral)', async () => {
      const r = await run(cmd('클리어', [], 'stranger'));
      expect(r.response.data!.flags).toBe(64);
      expect(content(r)).toContain('/등록');
    });

    it('1단계: 내 캐릭터 선택 메뉴 (값 = 캐릭터 이름)', async () => {
      const r = await run(cmd('클리어'));
      expect(r.response.type).toBe(4);
      expect(r.response.data!.flags).toBe(64);
      const select = r.response.data!.components![0].components[0] as StringSelect;
      expect(select.type).toBe(3);
      expect(select.custom_id).toBe('clr:c:fa');
      expect(select.options.map((o: any) => o.value)).toEqual(['A1', 'A2-sup']);
      expect(select.options[0].label).toContain('A1');
    });

    it('2단계: 레이드 다중 선택, 현재 클리어가 기본 선택', async () => {
      await store.setCharacterClears(WEEK, 'A1', [{ raidName: '세르카', difficulty: '하드' }]);
      const r = await run(comp('clr:c:fa', ['A1']));
      expect(r.response.type).toBe(7);
      const rows = r.response.data!.components!;
      const raidSelect = rows.flatMap((row: any) => row.components).find((c: any) => c.custom_id === `clr:r:fa:${WEEK}:A1`);
      expect(raidSelect.min_values).toBe(0);
      // A1은 1735: 입장할 수 있는 레이드 이름 5개 (3막, 4막, 성당, 종막, 세르카)만, 이름마다 하나
      expect(raidSelect.max_values).toBe(5);
      expect(raidSelect.options).toHaveLength(5);
      expect(raidSelect.options.map((o: any) => o.value)).toEqual(['mordum-hard', 'armoche-hard', 'cathedral-2', 'kazeros-hard', 'serka-hard']);
      expect(raidSelect.options.find((o: any) => o.value === 'serka-hard')).toMatchObject({ label: '세르카 하드', default: true });
      expect(raidSelect.options.filter((o: any) => o.default)).toHaveLength(1);
      for (const row of rows) for (const c of row.components) expect((c.custom_id ?? "").length).toBeLessThanOrEqual(100);
    });

    it('/클리어 제출: 같은 레이드 두 난이도면 오류, 정상이면 저장되고 /공대 후보에서 그 캐릭터가 빠진다', async () => {
      const before = all(await run(cmd('공대', [{ name: '레이드', value: 'serka-hard' }])));
      expect(before).toContain('**A1**');

      const bad = await run(comp(`clr:r:fa:${WEEK}:A1`, ['serka-hard', 'serka-normal']));
      expect([4, 7]).toContain(bad.response.type);
      expect(content(bad)).toContain('한 레이드는 한 난이도만 선택할 수 있어요');
      if (bad.response.type === 4) expect(bad.response.data!.flags).toBe(64);
      expect(await store.getClears(WEEK)).toEqual([]);

      const ok = await run(comp(`clr:r:fa:${WEEK}:A1`, ['serka-hard', 'cathedral-1']));
      expect(ok.response.type).toBe(7);
      expect(content(ok)).toContain('A1 클리어 2건 저장했어요');
      expect(await store.getClears(WEEK)).toEqual(expect.arrayContaining([
        { characterName: 'A1', raidName: '세르카', difficulty: '하드' },
        { characterName: 'A1', raidName: '지평의 성당', difficulty: '1단계' },
      ]));

      const after = all(await run(cmd('공대', [{ name: '레이드', value: 'serka-hard' }])));
      expect(after).not.toMatch(/\bA1\b/);
      expect(after).toContain('B1');
    });

    it('아무것도 고르지 않고 제출하면 클리어를 비운다', async () => {
      await store.setCharacterClears(WEEK, 'A1', [{ raidName: '세르카', difficulty: '하드' }]);
      const r = await run(comp(`clr:r:fa:${WEEK}:A1`, []));
      expect(content(r)).toContain('A1 클리어 0건 저장했어요');
      expect(await store.getClears(WEEK)).toEqual([]);
    });

    it('다른 친구의 캐릭터는 바꿀 수 없다', async () => {
      const r1 = await run(comp(`clr:r:fb:${WEEK}:B1`, ['serka-hard'], 'u1'));
      expect(r1.response.data!.flags).toBe(64);
      expect(content(r1)).toContain('내 캐릭터만 바꿀 수 있어요');
      const r2 = await run(comp('clr:c:fb', ['B1'], 'u1'));
      expect(content(r2)).toContain('내 캐릭터만 바꿀 수 있어요');
      expect(await store.getClears(WEEK)).toEqual([]);
    });

    it('없는 레이드 id는 알 수 없는 명령', async () => {
      expect(content(await run(comp(`clr:r:fa:${WEEK}:A1`, ['bogus'])))).toContain('알 수 없는 명령이에요');
      expect(await store.getClears(WEEK)).toEqual([]);
    });

    it('메뉴를 연 뒤 캐릭터가 사라졌으면 다시 실행하라고 안내하고 저장하지 않는다', async () => {
      for (const r of [await run(comp(`clr:r:fa:${WEEK}:Gone`, ['serka-hard'])), await run(comp('clr:c:fa', ['Gone']))]) {
        expect(r.response.data!.flags).toBe(64);
        expect(content(r)).toContain('캐릭터 목록이 바뀌었어요. `/클리어`를 다시 실행해 주세요');
      }
      expect(await store.getClears(WEEK)).toEqual([]);
    });

    it('단계 사이에 원정대 순서가 바뀌어도 이름으로 찾아 맞는 캐릭터에 저장한다', async () => {
      const step2 = await run(comp('clr:c:fa', ['A1']));
      const customId = step2.response.data!.components![1].components[0].custom_id!;
      await store.saveFriend({ ...friendA, characters: [ch('A0-new'), ch('A2-sup', 'support', 2500), ch('A1')] });
      const r = await run(comp(customId, ['serka-hard']));
      expect(content(r)).toContain('A1 클리어 1건 저장했어요');
      expect(await store.getClears(WEEK)).toEqual([{ characterName: 'A1', raidName: '세르카', difficulty: '하드' }]);
    });

    it('예전 형식(순번)의 메뉴는 저장하지 않고 다시 실행하라고 안내한다', async () => {
      const r = await run(comp('clr:r:fa:0', ['serka-hard']));
      expect(r.response.data!.flags).toBe(64);
      expect(content(r)).toMatch(/`\/클리어`를 다시 실행해 주세요/);
      expect(await store.getClears(WEEK)).toEqual([]);
    });

    it('메뉴를 연 뒤 새 주가 시작됐으면 거절하고 저장하지 않는다', async () => {
      const lastWeek = weekKey(new Date(NOW.getTime() - 7 * 86400000));
      const r = await run(comp(`clr:r:fa:${lastWeek}:A1`, ['serka-hard']));
      expect(r.response.data!.flags).toBe(64);
      expect(content(r)).toContain('새로운 주가 시작됐어요. `/클리어`를 다시 실행해 주세요');
      expect(await store.getClears(WEEK)).toEqual([]);
    });

    it('제출한 선택이 메뉴에 있는 레이드 전체를 대신하고, 메뉴에 없는 기록은 지금 저장된 값에서 가져와 남긴다', async () => {
      const step2 = await run(comp('clr:c:fa', ['A1']));
      const customId = step2.response.data!.components![1].components[0].custom_id!;
      // 메뉴를 연 뒤 웹에서 바뀐 기록: 메뉴에 있는 레이드(세르카)와 메뉴에 없는 기록(옛 레이드)
      await store.setCharacterClears(WEEK, 'A1', [{ raidName: '세르카', difficulty: '노말' }, { raidName: '옛 레이드', difficulty: '노말' }]);
      await run(comp(customId, ['cathedral-1']));
      expect(await store.getClears(WEEK)).toEqual(expect.arrayContaining([
        { characterName: 'A1', raidName: '지평의 성당', difficulty: '1단계' },
        { characterName: 'A1', raidName: '옛 레이드', difficulty: '노말' },
      ]));
      expect(await store.getClears(WEEK)).toHaveLength(2);
    });

    it('custom_id에 다 들어가지 않는 긴 이름은 짧은 해시로 담고 그 해시로 찾는다', async () => {
      const id = '123e4567-e89b-12d3-a456-426614174000';
      const longName = '가'.repeat(60);
      await store.saveFriend({ id, displayName: '긴이름', discordUserId: 'u7', representativeName: longName, characters: [ch(longName)] });
      const step1 = await run(cmd('클리어', [], 'u7'));
      const value = (step1.response.data!.components![0].components[0] as StringSelect).options[0].value;
      expect(value.length).toBeLessThanOrEqual(100);
      const step2 = await run(comp(`clr:c:${id}`, [value], 'u7'));
      const customId = step2.response.data!.components![1].components[0].custom_id as string;
      expect(customId.length).toBeLessThanOrEqual(100);
      expect(customId).toMatch(new RegExp(`^clr:r:${id}:${WEEK}:#[0-9a-f]+$`));
      expect(content(await run(comp(customId, ['serka-hard'], 'u7')))).toContain('클리어 1건 저장했어요');
      expect(await store.getClears(WEEK)).toEqual([{ characterName: longName, raidName: '세르카', difficulty: '하드' }]);
    });
  });

  it('/현황: 이번 주 클리어를 텍스트로 (공개)', async () => {
    await store.saveFriend(friendA);
    await store.setCharacterClears(WEEK, 'A1', [{ raidName: '세르카', difficulty: '하드' }]);
    const r = await run(cmd('현황'));
    expect(r.response.type).toBe(4);
    expect(r.response.data!.flags ?? 0).toBe(0);
    expect(all(r)).toContain('철수');
    expect(all(r)).toContain('**A1** · 세르카 하드 ✅');
    expect(all(r)).toContain('**A2-sup** · -');
  });

  it('알 수 없는 명령/custom_id는 ephemeral 안내', async () => {
    for (const body of [cmd('없는명령'), comp('zzz', [])]) {
      const r = await run(body);
      expect(r.response.data!.flags).toBe(64);
      expect(content(r)).toBe('알 수 없는 명령이에요');
    }
  });

  it('내부 오류는 일반 안내 (ephemeral)', async () => {
    deps.store = { ...store, listFriends: async () => { throw new Error('redis down token=abc'); } };
    const r = await run(cmd('현황'));
    expect(r.response.type).toBe(4);
    expect(r.response.data!.flags).toBe(64);
    expect(content(r)).toBe('문제가 생겼어요. 잠시 후 다시 시도해 주세요');
  });

  it('DM(user 필드)에서도 실행자를 인식한다', async () => {
    await store.saveFriend(friendA);
    const body = { ...cmd('클리어'), member: undefined, user: { id: 'u1', username: 'x' } };
    const r = await run(body);
    expect(r.response.data!.components![0].components[0].custom_id).toBe('clr:c:fa');
  });

  describe('/공대 버튼', () => {
    beforeEach(async () => { await store.saveFriend(friendA); await store.saveFriend(friendB); });

    it('/공대 응답에 다시 계산/클리어 표시 버튼이 있다', async () => {
      const r = await run(cmd('공대', [{ name: '레이드', value: 'serka-hard' }]));
      expect(r.response.data!.embeds!.length).toBeGreaterThan(0);
      expect(r.response.data!.components![0].components.map((c) => c.custom_id)).toEqual(['plan:serka-hard', 'clr:start']);
    });

    it('🔄 다시 계산: 최신 클리어로 다시 짜서 UPDATE_MESSAGE', async () => {
      await store.setCharacterClears(WEEK, 'A1', [{ raidName: '세르카', difficulty: '하드' }]);
      const r = await run(comp('plan:serka-hard', [], 'u2'));
      expect(r.response.type).toBe(7);
      expect(all(r)).not.toContain('**A1**');
      expect(all(r)).toContain('**B1**');
    });

    it('✅ 클리어 표시: 누른 사람의 /클리어 캐릭터 선택을 ephemeral로 연다', async () => {
      const r = await run(comp('clr:start', [], 'u2'));
      expect(r.response.type).toBe(4);
      expect(r.response.data!.flags).toBe(64);
      expect(r.response.data!.components![0].components[0].custom_id).toBe('clr:c:fb');
    });

    it('없는 레이드 id 버튼은 알 수 없는 명령', async () => {
      expect(content(await run(comp('plan:nope', [])))).toBe('알 수 없는 명령이에요');
    });
  });

  it('/클리어 2단계와 저장 응답에 캐릭터 요약 임베드가 붙는다', async () => {
    await store.saveFriend(friendA);
    const step2 = await run(comp('clr:c:fa', ['A1']));
    expect(step2.response.data!.embeds![0].title).toContain('A1');
    const saved = await run(comp(`clr:r:fa:${WEEK}:A1`, ['serka-hard']));
    expect(saved.response.data!.embeds![0].description).toBe('✅ 세르카 하드');
    const raidSelect = saved.response.data!.components![1].components[0] as { options: { value: string; default?: boolean }[] };
    expect(raidSelect.options.find((o) => o.value === 'serka-hard')!.default).toBe(true);
  });
});

describe('/숙련도', () => {
  beforeEach(async () => { await store.saveFriend(friendA); await store.saveFriend(friendB); });
  const prof = (character: unknown, raid: unknown, level: unknown, userId = 'u1') =>
    cmd('숙련도', [{ name: '캐릭터', value: character }, { name: '레이드', value: raid }, { name: '숙련도', value: level }], userId);
  const auto = (value: string, userId = 'u1', focused = '캐릭터') => ({
    type: 4, id: 'i3', application_id: 'app1', token: 'tok-secret', ...user(userId),
    data: {
      name: '숙련도',
      options: [
        { name: '캐릭터', type: 3, value, focused: focused === '캐릭터' },
        { name: '레이드', type: 3, value: '세르카', focused: focused === '레이드' },
      ],
    },
  });

  it('내 캐릭터의 레이드 숙련도를 저장하고 본인에게만 짧게 확인해 준다', async () => {
    const r = await run(prof('A1', '세르카', '숙련'));
    expect(r.response.type).toBe(4);
    expect(r.response.data!.flags).toBe(64);
    expect((await store.getFriend('fa'))!.proficiency).toEqual({ 'A1|세르카': '숙련' });
    const e = r.response.data!.embeds![0];
    expect(e.title).toContain('A1 · 세르카 → 숙련');
    expect(e.description).toContain('●숙련');
    expect(content(r)).toContain('A1 · 세르카 → 숙련');
    await run(prof(' A2-sup ', '벨가르딘', '클경'));
    expect((await store.getFriend('fa'))!.proficiency).toEqual({ 'A1|세르카': '숙련', 'A2-sup|벨가르딘': '클경' });
  });

  it('저장한 숙련도는 /공대 추천에 반영된다 (구성원 줄 배지)', async () => {
    await run(prof('A1', '세르카', '숙련'));
    const r = await run(cmd('공대', [{ name: '레이드', value: 'serka-hard' }]));
    expect(all(r)).toContain('**A1** ●숙련');
    expect(all(r)).toContain('**B1** ◐반숙');
  });

  it('등록 안 한 사용자는 /등록 안내, 다른 친구의 캐릭터는 바꿀 수 없다', async () => {
    const stranger = await run(prof('A1', '세르카', '숙련', 'stranger'));
    expect(stranger.response.data!.flags).toBe(64);
    expect(content(stranger)).toContain('/등록');
    const other = await run(prof('B1', '세르카', '숙련', 'u1'));
    expect(other.response.data!.flags).toBe(64);
    expect(content(other)).toContain('내 캐릭터만 바꿀 수 있어요');
    expect((await store.getFriend('fb'))!.proficiency).toBeUndefined();
  });

  it('없는 캐릭터/레이드/숙련도는 친절한 안내 (저장하지 않음)', async () => {
    const noChar = await run(prof('없는캐릭', '세르카', '숙련'));
    expect(noChar.response.data!.flags).toBe(64);
    expect(content(noChar)).toContain('내 원정대에 없는 캐릭터예요');
    expect(content(await run(prof('A1', '없는레이드', '숙련')))).toContain('알 수 없는 레이드예요');
    expect(content(await run(prof('A1', 'serka-hard', '숙련')))).toContain('알 수 없는 레이드예요');
    expect(content(await run(prof('A1', '세르카', '고수')))).toContain('숙련, 반숙, 클경 중에서 골라 주세요');
    expect(content(await run(prof('', '세르카', '숙련')))).toContain('캐릭터');
    expect((await store.getFriend('fa'))!.proficiency).toBeUndefined();
  });

  it('아무도 숙련도를 정하지 않았으면 /공대에 숙련도 배지·요약·경고가 없다', async () => {
    const r = await run(cmd('공대', [{ name: '레이드', value: 'serka-hard' }]));
    expect(all(r)).toContain('**A1** · ');
    expect(all(r)).not.toMatch(/숙련자 없음|◐반숙|숙련 0 · 반숙/);
  });

  it('반숙 하나만 직접 정해도 추적 중: 숙련자 없는 공대에 경고가 붙는다', async () => {
    await run(prof('A1', '세르카', '반숙'));
    const r = await run(cmd('공대', [{ name: '레이드', value: 'serka-hard' }]));
    expect(all(r)).toContain('숙련자 없음');
    expect(all(r)).toContain('**B1** ◐반숙');
  });

  it('/명령어 도움말에 /숙련도가 나온다', async () => {
    expect(all(await run(cmd('명령어')))).toContain('/숙련도');
  });

  describe('캐릭터 자동완성 (interaction type 4 → 응답 type 8)', () => {
    it('내 캐릭터만, 입력한 글자로 걸러서 (레벨 높은 순)', async () => {
      const r = await run(auto(''));
      expect(r.response.type).toBe(8);
      expect(r.response.data!.choices!.map((c) => c.value)).toEqual(['A1', 'A2-sup']);
      expect(r.response.data!.choices![0].name).toContain('A1');
      expect(r.response.data).not.toHaveProperty('flags');
      const filtered = await run(auto('SUP'));
      expect(filtered.response.data!.choices!.map((c) => c.value)).toEqual(['A2-sup']);
    });

    it('캐릭터가 많아도 25개까지', async () => {
      await store.saveFriend({ ...friendA, characters: Array.from({ length: 30 }, (_, i) => ch('C' + i, 'dealer', 3000, 1700 + i)) });
      const r = await run(auto(''));
      expect(r.response.data!.choices).toHaveLength(25);
      expect(r.response.data!.choices![0].value).toBe('C29');
    });

    it('등록 안 한 사용자나 다른 옵션의 자동완성은 빈 목록', async () => {
      expect((await run(auto('', 'stranger'))).response).toEqual({ type: 8, data: { choices: [] } });
      expect((await run(auto('', 'u1', '레이드'))).response).toEqual({ type: 8, data: { choices: [] } });
    });

    it('저장소 오류에도 자동완성 응답 형식(type 8)을 지킨다', async () => {
      deps.store = { ...store, listFriends: async () => { throw new Error('down'); } };
      expect((await run(auto(''))).response).toEqual({ type: 8, data: { choices: [] } });
    });
  });
});

describe('1700 미만 캐릭터는 디스코드에서도 숨긴다 (설계 수정 B)', () => {
  const low: Friend = { ...friendA, characters: [ch('A1'), ch('A-low', 'dealer', 3000, 1699), ch('A2-sup', 'support', 2500)] };
  beforeEach(async () => { await store.saveFriend(low); });

  it('/클리어 캐릭터 메뉴에 없다', async () => {
    const r = await run(cmd('클리어'));
    const select = r.response.data!.components![0].components[0] as StringSelect;
    expect(select.options.map((o: any) => o.value)).toEqual(['A1', 'A2-sup']);
  });

  it('/현황에 없다', async () => {
    const r = await run(cmd('현황'));
    expect(all(r)).not.toContain('A-low');
    expect(all(r)).toContain('**A1**');
  });

  it('/숙련도 자동완성에 없고, 직접 쳐도 바꿀 수 없다', async () => {
    const r = await run({ type: 4, id: 'i3', application_id: 'app1', token: 't', ...user('u1'),
      data: { name: '숙련도', options: [{ name: '캐릭터', type: 3, value: '', focused: true }] } });
    expect(r.response.data!.choices!.map((c: any) => c.value)).toEqual(['A1', 'A2-sup']);
    const set = await run(cmd('숙련도', [{ name: '캐릭터', value: 'A-low' }, { name: '레이드', value: '세르카' }, { name: '숙련도', value: '숙련' }]));
    expect(set.response.data!.flags).toBe(64);
    expect((await store.getFriend('fa'))!.proficiency).toBeUndefined();
  });
});

describe('/클리어 레이드 메뉴: 가는 난이도 (설계 수정 A)', () => {
  const sel = async (character: string, friend: Friend = friendA) => {
    await store.saveFriend(friend);
    const r = await run(comp(`clr:c:${friend.id}`, [character], friend.discordUserId));
    return (r.response.data!.components as any[]).flatMap((row) => row.components).find((c: any) => c.custom_id?.startsWith('clr:r:')) as StringSelect;
  };

  it('입장할 수 없는 레이드는 없고(1700은 3개), 이름마다 하나, 값은 가는 난이도의 레이드 id', async () => {
    const low: Friend = { ...friendA, characters: [ch('Lo', 'dealer', 3000, 1705)] };
    const s = await sel('Lo', low);
    expect(s.options.map((o) => o.value)).toEqual(['mordum-hard', 'armoche-normal', 'cathedral-1']);
    expect(s.max_values).toBe(3);
  });

  it('직접 정한 가는 난이도가 라벨에 나온다 (4막 노말로 가는 1735)', async () => {
    await store.saveFriend(friendA);
    await store.setTargetDifficulty('fa', 'A1', '카제로스 4막 (아르모체)', '노말');
    const s = await sel('A1');
    const four = s.options.filter((o) => o.label.startsWith('카제로스 4막'));
    expect(four).toEqual([{ label: '카제로스 4막 (아르모체) 노말', value: 'armoche-normal' }]);
  });

  it('안 감으로 정한 레이드도 메뉴에는 자동 난이도로 남는다 (이미 갔을 수 있어서)', async () => {
    await store.saveFriend(friendA);
    await store.setTargetDifficulty('fa', 'A1', '세르카', '안 감');
    const s = await sel('A1');
    expect(s.options.find((o) => o.value === 'serka-hard')).toBeDefined();
  });

  it('레벨보다 높게 정해 둔 난이도는 메뉴에서 자동 난이도로 보인다', async () => {
    await store.saveFriend(friendA);
    await store.setTargetDifficulty('fa', 'A1', '세르카', '나이트메어'); // 1735 < 1740
    const s = await sel('A1');
    expect(s.options.filter((o) => o.label.startsWith('세르카')).map((o) => o.value)).toEqual(['serka-hard']);
  });

  it('이미 다른 난이도로 클리어했다면 그 난이도가 보이고 기본 선택, 설명으로 가는 난이도를 알려 준다', async () => {
    await store.saveFriend(friendA);
    await store.setCharacterClears(WEEK, 'A1', [{ raidName: '세르카', difficulty: '노말' }]);
    const s = await sel('A1');
    const serka = s.options.filter((o) => o.label.startsWith('세르카'));
    expect(serka).toEqual([{ label: '세르카 노말', value: 'serka-normal', description: '가는 난이도는 하드예요', default: true }]);
  });

  it('제출: 메뉴에 없는 레이드(레벨 부족)는 저장하지 않고, 레벨 모자라 안 보이는 기존 기록은 남는다', async () => {
    const low: Friend = { ...friendA, characters: [ch('Lo', 'dealer', 3000, 1705)] };
    await store.saveFriend(low);
    await store.setCharacterClears(WEEK, 'Lo', [{ raidName: '벨가르딘', difficulty: '노말' }]);
    const bad = await run(comp(`clr:r:fa:${WEEK}:Lo`, ['serka-hard']));
    expect(content(bad)).toContain('갈 수 없는 레이드');
    expect(await store.getClears(WEEK)).toEqual([{ characterName: 'Lo', raidName: '벨가르딘', difficulty: '노말' }]);
    const ok = await run(comp(`clr:r:fa:${WEEK}:Lo`, ['cathedral-1']));
    expect(content(ok)).toContain('Lo 클리어 1건 저장했어요');
    expect(await store.getClears(WEEK)).toEqual(expect.arrayContaining([
      { characterName: 'Lo', raidName: '벨가르딘', difficulty: '노말' }, { characterName: 'Lo', raidName: '지평의 성당', difficulty: '1단계' },
    ]));
  });
});

describe('/난이도', () => {
  beforeEach(async () => { await store.saveFriend(friendA); await store.saveFriend(friendB); });
  const diff = (character: unknown, raid: unknown, level: unknown, userId = 'u1') =>
    cmd('난이도', [{ name: '캐릭터', value: character }, { name: '레이드', value: raid }, { name: '난이도', value: level }], userId);
  const auto = (value: string, userId = 'u1', name = '난이도') => ({
    type: 4, id: 'i3', application_id: 'app1', token: 'tok-secret', ...user(userId),
    data: { name, options: [{ name: '캐릭터', type: 3, value, focused: true }] },
  });

  it('명령어 정의: 옵션 3개, 한국어 설명, 난이도 선택지는 자동 + 6개 이름 + 안 감 (25개 이내)', () => {
    const c = COMMANDS.find((x) => x.name === '난이도')!;
    expect(c.options!.map((o) => [o.name, o.type, o.required])).toEqual([['캐릭터', 3, true], ['레이드', 3, true], ['난이도', 3, true]]);
    expect(c.options![0].autocomplete).toBe(true);
    expect(c.options![1].choices!.map((x) => x.value)).toEqual([...new Set(RAIDS.map((r) => r.name))]);
    expect(c.options![2].choices!.map((x) => x.value)).toEqual(['자동', '노말', '하드', '나이트메어', '1단계', '2단계', '3단계', '안 감']);
    for (const o of c.options!) expect((o.choices ?? []).length).toBeLessThanOrEqual(25);
    expect(c.description.length).toBeLessThanOrEqual(100);
    const reg = registrationPayload().find((x) => x.name === '난이도')!;
    expect(reg.options![0]).toMatchObject({ name: '캐릭터', autocomplete: true });
    for (const o of reg.options!) expect(o.description).toMatch(/[가-힣]/);
  });

  it('난이도를 저장하고 본인에게만 확인 카드(캐릭터 · 레이드 → 난이도, 실제 난이도)를 준다', async () => {
    const r = await run(diff('A1', '카제로스 4막 (아르모체)', '노말'));
    expect(r.response.type).toBe(4);
    expect(r.response.data!.flags).toBe(64);
    expect(all(r)).toContain('A1 · 카제로스 4막 (아르모체) → 노말');
    expect(all(r)).toContain('실제로 가는 난이도: 노말');
    expect((await store.getFriend('fa'))!.targetDifficulty).toEqual({ 'A1|카제로스 4막 (아르모체)': '노말' });
    // /공대: 4막 하드 후보에서는 빠지고 노말 후보가 된다
    expect(all(await run(cmd('공대', [{ name: '레이드', value: 'armoche-hard' }])))).not.toMatch(/\*\*A1\*\*/);
    expect(all(await run(cmd('공대', [{ name: '레이드', value: 'armoche-normal' }])))).toMatch(/\*\*A1\*\*/);
  });

  it('자동은 저장값을 지우고 "자동 → 하드"처럼 실제 난이도를 보여 준다', async () => {
    await store.setTargetDifficulty('fa', 'A1', '카제로스 4막 (아르모체)', '노말');
    const r = await run(diff('A1', '카제로스 4막 (아르모체)', '자동'));
    expect(all(r)).toContain('자동 → 하드');
    expect((await store.getFriend('fa'))!.targetDifficulty).toBeUndefined();
  });

  it('안 감은 저장되고 추천에서 빠진다는 안내', async () => {
    const r = await run(diff('A1', '세르카', '안 감'));
    expect(all(r)).toContain('공대 추천에서 빠져요');
    expect((await store.getFriend('fa'))!.targetDifficulty).toEqual({ 'A1|세르카': '안 감' });
  });

  it('레벨보다 높은 난이도는 저장하되(오류 아님) 레벨이 되면 적용된다고 알려 준다', async () => {
    const r = await run(diff('A1', '세르카', '나이트메어')); // A1 1735, 나이트메어 1740
    expect(all(r)).not.toContain('⚠️');
    expect(all(r)).toContain('입장 레벨(1740)');
    expect(all(r)).toContain('레벨이 되면');
    expect((await store.getFriend('fa'))!.targetDifficulty).toEqual({ 'A1|세르카': '나이트메어' });
  });

  it('그 레이드에 없는 난이도면 친절한 오류와 가능한 난이도 목록 (저장하지 않음)', async () => {
    const r = await run(diff('A1', '세르카', '3단계'));
    expect(r.response.data!.flags).toBe(64);
    expect(all(r)).toContain('세르카에는 3단계 난이도가 없어요');
    expect(all(r)).toContain('노말, 하드, 나이트메어');
    expect((await store.getFriend('fa'))!.targetDifficulty).toBeUndefined();
  });

  it('없는 캐릭터, 다른 친구 캐릭터, 알 수 없는 레이드, 미등록 사용자', async () => {
    expect(all(await run(diff('Nobody', '세르카', '하드')))).toContain('내 원정대에 없는 캐릭터');
    const other = await run(diff('B1', '세르카', '하드'));
    expect(all(other)).toContain('내 캐릭터만 바꿀 수 있어요');
    expect(all(await run(diff('A1', '없는레이드', '하드')))).toContain('알 수 없는 레이드');
    const stranger = await run(diff('A1', '세르카', '하드', 'stranger'));
    expect(stranger.response.data!.flags).toBe(64);
    expect(all(stranger)).toContain('/등록');
    expect((await store.getFriend('fb'))!.targetDifficulty).toBeUndefined();
  });

  it('1700 미만 캐릭터는 바꿀 수 없다', async () => {
    await store.saveFriend({ ...friendA, characters: [ch('A1'), ch('A-low', 'dealer', 3000, 1699)] });
    const r = await run(diff('A-low', '세르카', '노말'));
    expect(all(r)).toContain('내 원정대에 없는 캐릭터');
    expect((await store.getFriend('fa'))!.targetDifficulty).toBeUndefined();
  });

  it('자동완성: 내 보이는 캐릭터만, 필터, 25개까지, 낯선 사용자는 빈 목록, type 8', async () => {
    await store.saveFriend({ ...friendA, characters: [ch('A1'), ch('A-low', 'dealer', 3000, 1699), ch('A2-sup', 'support', 2500)] });
    const r = await run(auto(''));
    expect(r.response.type).toBe(8);
    expect(r.response.data!.choices!.map((c) => c.value)).toEqual(['A1', 'A2-sup']);
    expect((await run(auto('sup'))).response.data!.choices!.map((c) => c.value)).toEqual(['A2-sup']);
    expect((await run(auto('', 'stranger'))).response).toEqual({ type: 8, data: { choices: [] } });
    await store.saveFriend({ ...friendA, characters: Array.from({ length: 30 }, (_, i) => ch('C' + i, 'dealer', 3000, 1700 + i)) });
    expect((await run(auto(''))).response.data!.choices).toHaveLength(25);
  });

  it('/명령어 도움말에 /난이도가 나온다', async () => {
    expect(all(await run(cmd('명령어')))).toContain('/난이도');
  });
});
