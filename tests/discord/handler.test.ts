import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryStore, type Store } from '@/store/store';
import { handleInteraction, type Deps } from '@/discord/handler';
import { COMMANDS } from '@/discord/commands';
import { LostArkError } from '@/lostark/client';
import { RAIDS } from '@/core/raids';
import { weekKey } from '@/core/week';
import type { Character, Friend } from '@/core/types';
import { getWebUrl } from '@/lib/web-url';
import type { StringSelect } from '@/discord/types';

const NOW = new Date('2026-10-16T03:00:00Z');
const WEEK = weekKey(NOW);
const ch = (name: string, role: 'dealer' | 'support' = 'dealer', cp: number | null = 3800, itemLevel = 1760): Character =>
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
  it('명령어, 등록, 공대, 클리어, 현황, 웹', () => {
    expect(COMMANDS.map((c) => c.name).sort()).toEqual(['공대', '등록', '명령어', '클리어', '현황', '웹'].sort());
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
      expect(raidSelect.max_values).toBe(14);
      expect(raidSelect.options).toHaveLength(14);
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
