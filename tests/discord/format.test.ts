import { describe, it, expect } from 'vitest';
import {
  clipLines, clipText, embedSize, errorParts, fitEmbeds, fitMessage, formatHelp, formatPlan, formatStatus, gauge,
  characterClearsEmbed, registerSuccess, BLOCK_SEPARATOR, raidTitle, sanitizeEmbed, LIMITS, MAX_CONTENT, TIER_TEXT,
  unplacedFieldValue, UNPLACED_NOTE,
} from '@/discord/format';
import { COLOR, ICON, TIER_COLOR } from '@/discord/theme';
import { COMMANDS } from '@/discord/commands';
import { getRaid } from '@/core/raids';
import type { Candidate, Character, Friend, Party, PlanResult, Slot } from '@/core/types';
import { planRaid } from '@/core/planner';
import type { Embed } from '@/discord/types';

const NOW = new Date('2026-10-16T03:00:00Z');
const ch = (name: string, role: 'dealer' | 'support' = 'dealer', cp: number | null = 3000, itemLevel = 1760): Character =>
  ({ name, className: '버서커', role, itemLevel, combatPower: cp });
const fr = (id: string, displayName: string, chars: Character[]): Friend =>
  ({ id, displayName, representativeName: chars[0].name, characters: chars });
const serkaHard = getRaid('serka-hard')!; // 권장 3600~4000

/** 디스코드 임베드 제한을 모두 지키는지. */
function expectValidEmbeds(embeds: Embed[]) {
  expect(embeds.length).toBeGreaterThan(0);
  expect(embeds.length).toBeLessThanOrEqual(10);
  expect(embeds.reduce((s, e) => s + embedSize(e), 0)).toBeLessThanOrEqual(6000);
  for (const e of embeds) {
    expect(e.title?.length ?? 0).toBeLessThanOrEqual(256);
    expect(e.author?.name.length ?? 0).toBeLessThanOrEqual(256);
    expect(e.description?.length ?? 0).toBeLessThanOrEqual(4096);
    expect(e.footer?.text.length ?? 0).toBeLessThanOrEqual(2048);
    expect(e.fields?.length ?? 0).toBeLessThanOrEqual(25);
    for (const f of e.fields ?? []) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.name.length).toBeLessThanOrEqual(256);
      expect(f.value.length).toBeGreaterThan(0);
      expect(f.value.length).toBeLessThanOrEqual(1024);
    }
  }
}

describe('길이 맞추기', () => {
  it('MAX_CONTENT는 2000', () => expect(MAX_CONTENT).toBe(2000));
  it('fitMessage: 짧으면 그대로', () => expect(fitMessage('a\nb')).toBe('a\nb'));

  it('fitMessage: 2000자를 넘으면 줄 단위로 자르고 생략 안내를 붙인다', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `줄 ${i} ${'가'.repeat(10)}`);
    const out = fitMessage(lines.join('\n'));
    expect(out.length).toBeLessThanOrEqual(2000);
    const outLines = out.split('\n');
    expect(outLines.pop()).toContain('생략');
    for (const l of outLines) expect(lines).toContain(l);
  });

  it('fitMessage/clipLines: 한 줄이 한도보다 길어도 한도를 넘지 않는다', () => {
    expect(fitMessage('x'.repeat(5000)).length).toBeLessThanOrEqual(2000);
    expect(clipLines('y'.repeat(3000), 1024).length).toBeLessThanOrEqual(1024);
  });

  it('clipText는 이모지(서로게이트 쌍)를 깨지 않고 "…"로 끝난다', () => {
    const out = clipText('🛡️'.repeat(200), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('sanitizeEmbed: 모든 제한을 지키고 빈 필드를 막는다', () => {
    const e = sanitizeEmbed({
      author: { name: 'a'.repeat(400) },
      title: 't'.repeat(400),
      description: Array.from({ length: 1000 }, () => 'd'.repeat(9)).join('\n'),
      fields: Array.from({ length: 40 }, (_, i) => ({ name: i === 0 ? '' : 'n'.repeat(300), value: i === 1 ? '' : Array.from({ length: 200 }, () => 'v'.repeat(9)).join('\n') })),
      footer: { text: 'f'.repeat(3000) },
    });
    expectValidEmbeds([e]);
    expect(e.fields!.length).toBeGreaterThan(0);
    // 필드 값은 줄 단위로 잘리고 "…"로 끝난다
    expect(e.fields![0].value.split('\n').slice(0, -1).every((l) => l === 'v'.repeat(9))).toBe(true);
  });

  it('fitEmbeds: 10개, 합계 6000자를 넘지 않게 뒤쪽 임베드를 뺀다', () => {
    const big: Embed = { title: 'x', description: 'd'.repeat(2500) };
    const out = fitEmbeds(Array.from({ length: 12 }, () => big));
    expectValidEmbeds(out);
    expect(out).toHaveLength(2);
    expect(fitEmbeds(Array.from({ length: 12 }, () => ({ title: 'x' })))).toHaveLength(10);
  });
});

describe('gauge', () => {
  it('0% → 빈 막대', () => expect(gauge(0, 3600)).toBe('▱▱▱▱▱▱▱▱▱▱ 0%'));
  it('100% → 가득', () => expect(gauge(3600, 3600)).toBe('▰▰▰▰▰▰▰▰▰▰ 100%'));
  it('94%', () => expect(gauge(3384, 3600)).toBe('▰▰▰▰▰▰▰▰▰▱ 94%'));
  it('100% 초과면 막대는 가득, 숫자는 실제 비율', () => expect(gauge(5400, 3600)).toBe('▰▰▰▰▰▰▰▰▰▰ 150%'));
  it('null → 정보 없음', () => expect(gauge(null, 3600)).toBe('▱▱▱▱▱▱▱▱▱▱ 정보 없음'));
});

describe('theme', () => {
  it('단계 이모지/색', () => {
    expect(TIER_TEXT).toEqual({ comfortable: '🟢 여유', tight: '🟡 빠듯함', risky: '🔴 위험', unknown: '⚪ 모름' });
    expect(TIER_COLOR).toEqual({ comfortable: 0x57f287, tight: 0xfee75c, risky: 0xed4245, unknown: 0x95a5a6 });
  });
  it('raidTitle은 "이름 난이도"', () => expect(raidTitle(serkaHard)).toBe('세르카 하드'));
});

describe('formatPlan', () => {
  const friends = [
    fr('a', '철수', [ch('A1', 'dealer', 3800, 1745), ch('A2', 'dealer', 3000, 1740)]),
    fr('b', '영희', [ch('B1', 'support', 2500, 1740)]),
  ];
  const party = (tier: Party['tier'], avg: number | null, slots: Slot[]): Party => ({ tier, dealerAvgCP: avg, slots });
  const summary = (s: Partial<Candidate['summary']>): Candidate['summary'] => ({
    friendCount: 2, characterCount: 3, partyCount: 2, externalCount: 5, externalSupports: 1, externalDealers: 4, friendThreshold: 2, ...s,
  });
  // 추천 1: 철수가 A1(숙련)로 1공대, A2(클경)로 2공대 / 영희는 1공대 (숙련도 없음 = 반숙)
  const first: Candidate = {
    kind: 'recommended', summary: summary({}), imbalance: 800, unplaced: [],
    parties: [
      party('comfortable', 3800, [
        { kind: 'friend', friendId: 'a', character: friends[0].characters[0], proficiency: '숙련' },
        { kind: 'friend', friendId: 'b', character: friends[1].characters[0] },
        { kind: 'external', role: 'dealer' },
        { kind: 'external', role: 'dealer' },
      ]),
      party('risky', 3000, [
        { kind: 'friend', friendId: 'a', character: friends[0].characters[1], proficiency: '클경' },
        { kind: 'external', role: 'support' },
        { kind: 'external', role: 'dealer' },
        { kind: 'external', role: 'dealer' },
      ]),
    ],
  };
  const second: Candidate = {
    kind: 'recommended', summary: summary({}), imbalance: 0, unplaced: [],
    parties: [
      party('unknown', null, [
        { kind: 'friend', friendId: 'b', character: friends[1].characters[0] },
        { kind: 'external', role: 'dealer' }, { kind: 'external', role: 'dealer' }, { kind: 'external', role: 'dealer' },
      ]),
      party('tight', 3400, [
        { kind: 'friend', friendId: 'a', character: friends[0].characters[0] },
        { kind: 'external', role: 'support' }, { kind: 'external', role: 'dealer' }, { kind: 'external', role: 'dealer' },
      ]),
    ],
  };
  const result: PlanResult = { candidates: [first, second], excluded: [{ friendId: 'c', reason: '가능한 캐릭터 없음' }], proficiencyTracked: true };
  const all = [...friends, fr('c', '민수', [ch('C1')])];

  it('추천마다 임베드 하나: 제목 "추천 N · 레이드"(첫 번째 ⭐), 설명 = 요약 한 줄, 공대마다 칸 하나, 꼬리말', () => {
    const msg = formatPlan(serkaHard, result, all, NOW);
    expectValidEmbeds(msg.embeds);
    expect(msg.embeds).toHaveLength(2);
    const [e1, e2] = msg.embeds;
    expect(e1.title).toBe('⭐ 추천 1 · 세르카 하드');
    expect(e2.title).toBe('추천 2 · 세르카 하드');
    expect(e1.color).toBe(COLOR.risky); // 가장 나쁜 공대
    expect(e2.color).toBe(COLOR.tight);
    expect(e1.author!.name).toContain('공대 추천');
    expect(e1.timestamp).toBe(NOW.toISOString());
    const desc = e1.description!.split('\n');
    expect(desc[0]).toBe('친구 2명 · 캐릭터 3개 편성 · 공대 2개 · 외부 5명 필요 (서포터 1, 딜러 4)');
    expect(desc[1]).toBe('권장 전투력 3,600~4,000');
    expect(e1.description).toContain('민수 (가능한 캐릭터 없음)');
    expect(e2.description).not.toContain('민수');
    // 공대 둘 사이에 빈칸 칸
    // 공대 칸 제목에 숙련도 요약, 숙련자가 없으면 경고
    expect(e1.fields!.map((f) => f.name)).toEqual([
      '1공대 · 평균 3,800 🟢 여유 · 숙련 1 · 반숙 1 · 클경 0', '​', '2공대 · 평균 3,000 🔴 위험 · 숙련 0 · 반숙 0 · 클경 1 · ⚠️ 숙련자 없음',
    ]);
    expect(e2.fields![0].name).toBe('1공대 · 평균 정보 없음 ⚪ 모름 · 숙련 0 · 반숙 1 · 클경 0 · ⚠️ 숙련자 없음');
    const lines = e1.fields![0].value.split('\n');
    expect(lines[0]).toBe('`▰▰▰▰▰▰▰▰▰▰ 106%`');
    expect(lines[1]).toBe('⚔️ **A1** ●숙련 · 1745 · CP 3,800 · 철수');
    // 딜러 먼저(친구 → 외부), 서포터는 맨 아래
    expect(lines[2]).toBe('➕ 외부 딜러 구하기');
    expect(lines[3]).toBe('➕ 외부 딜러 구하기');
    expect(lines[4]).toBe('🛡️ **B1** ◐반숙 · 1740 · 영희');
    // 같은 친구(철수)가 2공대에 다른 캐릭터로
    expect(e1.fields![2].value).toContain('⚔️ **A2** ○클경 · 1740 · CP 3,000 · 철수');
    expect(e1.fields![2].value).toContain('➕ 외부 서포터 구하기');
    expect(e1.footer!.text).toContain('외부 5명 필요 (서포터 1, 딜러 4)');
    expect(e1.footer!.text).toContain('🗓️ 이번 주: 2026-10-14 수요일 06:00 초기화');
    expect(msg.content).toBe('🏰 세르카 하드 공대 추천 2개를 찾았어요');
    expect(JSON.stringify(msg)).not.toContain('분배');
  });

  it('숙련도를 아무도 정하지 않았으면(추적 안 함) 공대 칸 제목과 구성원 줄은 예전 그대로 (요약·경고·기본 배지 없음)', () => {
    const plain: Candidate = { ...first, parties: first.parties.map((p) => ({ ...p, slots: p.slots.map((s) => (s.kind === 'friend' ? { ...s, proficiency: '반숙' as const } : s)) })) };
    for (const r of [{ ...result, candidates: [plain, second], proficiencyTracked: false }, { ...result, candidates: [plain, second], proficiencyTracked: undefined }]) {
      const msg = formatPlan(serkaHard, r, all, NOW);
      expectValidEmbeds(msg.embeds);
      const [e1, e2] = msg.embeds;
      expect(e1.fields!.map((f) => f.name)).toEqual(['1공대 · 평균 3,800 🟢 여유', '​', '2공대 · 평균 3,000 🔴 위험']);
      expect(e2.fields![0].name).toBe('1공대 · 평균 정보 없음 ⚪ 모름');
      const lines = e1.fields![0].value.split('\n');
      expect(lines[1]).toBe('⚔️ **A1** · 1745 · CP 3,800 · 철수');
      expect(lines[4]).toBe('🛡️ **B1** · 1740 · 영희');
      expect(JSON.stringify(msg)).not.toContain('숙련자 없음');
      expect(JSON.stringify(msg)).not.toContain('◐');
    }
  });

  it('추적 중이면 모두 클경인 공대에도 "숙련자 없음" 경고, 숙련자가 있는 공대에는 없음', () => {
    const allNovice: Candidate = { ...first, parties: first.parties.map((p) => ({ ...p, slots: p.slots.map((s) => (s.kind === 'friend' ? { ...s, proficiency: '클경' as const } : s)) })) };
    const msg = formatPlan(serkaHard, { candidates: [allNovice], excluded: [], proficiencyTracked: true }, all, NOW);
    expect(msg.embeds[0].fields!.filter((f) => f.name.includes('⚠️ 숙련자 없음'))).toHaveLength(2);
    expect(msg.embeds[0].fields![0].value).toContain('**A1** ○클경');
    const withExpert = formatPlan(serkaHard, result, all, NOW).embeds[0];
    expect(withExpert.fields![0].name).not.toContain('숙련자 없음');
  });

  it('8인 공대: 딜러 3 → 서포터 1 두 묶음을 구분선으로 나눈다', () => {
    const kz = getRaid('kazeros-hard')!;
    const ds = [1, 2, 3, 4, 5, 6].map((i) => ch(`D${i}`, 'dealer', i * 1000, 1740));
    const sup = [ch('S1', 'support', null, 1750), ch('S2', 'support', null, 1745)];
    const fs8 = [fr('a', '철수', [...ds, ...sup])];
    const slots: Slot[] = [sup[1], ...ds, sup[0]].map((c) => ({ kind: 'friend', friendId: 'a', character: c }));
    const cand8: Candidate = { kind: 'recommended', summary: summary({ externalCount: 0, externalSupports: 0, externalDealers: 0, friendThreshold: 1 }), imbalance: 0, unplaced: [], parties: [party('comfortable', 3500, slots)] };
    const msg = formatPlan(kz, { candidates: [cand8], excluded: [] }, fs8, NOW);
    expectValidEmbeds(msg.embeds);
    const lines = msg.embeds[0].fields![0].value.split('\n').slice(1); // 게이지 줄 제외
    const names = lines.map((l) => (l === BLOCK_SEPARATOR ? '--' : /\*\*(\w+)\*\*/.exec(l)![1]));
    expect(names).toEqual(['D6', 'D3', 'D2', 'S1', '--', 'D5', 'D4', 'D1', 'S2']);
  });

  it('외부 인원이 없으면 "친구들만으로 구성 가능"', () => {
    const r: PlanResult = {
      candidates: [{
        summary: summary({ friendCount: 1, characterCount: 1, partyCount: 1, externalCount: 0, externalSupports: 0, externalDealers: 0, friendThreshold: 1 }),
        kind: 'recommended', imbalance: 0, unplaced: [],
        parties: [party('tight', 3300, [{ kind: 'friend', friendId: 'a', character: friends[0].characters[0] }])],
      }],
      excluded: [],
    };
    const e = formatPlan(serkaHard, r, friends, NOW).embeds[0];
    expect(e.description!.split('\n')[0]).toBe('친구 1명 · 캐릭터 1개 편성 · 공대 1개 · 친구들만으로 구성 가능');
    expect(e.footer!.text).toContain('친구들만으로 구성 가능');
    expect(e.color).toBe(COLOR.tight);
  });

  it('다시 계산 / 클리어 표시 버튼 (custom_id ≤ 100)', () => {
    const msg = formatPlan(serkaHard, result, all, NOW);
    const buttons = msg.components![0].components;
    expect(buttons.map((b) => b.custom_id)).toEqual(['plan:serka-hard', 'clr:start']);
    expect(buttons.every((b) => b.type === 2 && (b.custom_id ?? "").length <= 100)).toBe(true);
  });

  it('추천이 없으면 회색 임베드 하나에 사유를 문장으로', () => {
    const msg = formatPlan(serkaHard, { candidates: [], excluded: [{ friendId: 'a', reason: '가능한 캐릭터 없음' }], reason: '참석할 수 있는 캐릭터가 없어요' }, friends, NOW);
    expect(msg.embeds).toHaveLength(1);
    expect(msg.embeds[0].color).toBe(COLOR.unknown);
    expect(msg.embeds[0].description).toContain('참석할 수 있는 캐릭터가 없어요');
    expect(msg.embeds[0].description).toContain('철수');
  });

  it('추천이 10개를 넘어도 임베드는 10개까지, 합계 6000자 안 (작은 추천 12개)', () => {
    const small: Candidate = {
      summary: summary({ friendCount: 1, characterCount: 1, partyCount: 1, externalCount: 3, externalSupports: 1, externalDealers: 2, friendThreshold: 1 }),
      kind: 'recommended', imbalance: 0, unplaced: [],
      parties: [party('tight', 3300, [
        { kind: 'friend', friendId: 'a', character: friends[0].characters[0] },
        { kind: 'external', role: 'support' }, { kind: 'external', role: 'dealer' }, { kind: 'external', role: 'dealer' },
      ])],
    };
    const msg = formatPlan(serkaHard, { candidates: Array.from({ length: 12 }, () => small), excluded: [] }, friends, NOW);
    expectValidEmbeds(msg.embeds);
    expect(msg.embeds).toHaveLength(10);
    expect(msg.embeds[9].title).toBe('추천 10 · 세르카 하드');
    expect(msg.content).toBe('🏰 세르카 하드 공대 추천 12개를 찾았어요 (길어서 10개만 보여요)');
  });

  // 실제 플래너 결과로 만드는 최악의 경우: 긴 이름의 친구 8명 x 캐릭터 6개
  const longRoster = (suffix = '') => {
    const roles: Character['role'][] = ['dealer', 'dealer', 'support', 'dealer', 'support', 'dealer'];
    return Array.from({ length: 8 }, (_, f) => fr(`f${f}${suffix}`, `아주아주긴친구표시이름${f}번째${suffix}`,
      roles.map((role, k) => ch(`캐릭터이름이엄청나게긴캐릭터${f}-${k}${suffix}`, role, 123456 + f * 1000 + k, 1765.83))));
  };
  const allPlaced = (msg: ReturnType<typeof formatPlan>, cand: Candidate) => {
    const text = msg.embeds[0].fields!.map((f) => f.value).join('\n');
    return cand.parties.flatMap((p) => p.slots).every((s) => s.kind !== 'friend' || text.includes(`**${s.character.name}**`));
  };

  it('최악의 경우(8인 레이드, 친구 8명 x 캐릭터 6개 → 공대 8개, 추천 3개, 빠진 친구 30명)도 유효한 임베드, 첫 추천의 공대는 다 보인다', () => {
    const roster = longRoster();
    const raid = getRaid('kazeros-hard')!;
    const plan = planRaid({ raid, friends: roster, clears: [], attendeeIds: roster.map((f) => f.id) });
    expect(plan.candidates).toHaveLength(3);
    expect(plan.candidates[0].parties).toHaveLength(8);
    const r: PlanResult = { ...plan, excluded: Array.from({ length: 30 }, (_, i) => ({ friendId: `x${i}`, reason: '가능한 캐릭터 없음' })) };
    const msg = formatPlan(raid, r, roster, NOW);
    expectValidEmbeds(msg.embeds);
    expect(msg.embeds[0].title).toBe(`⭐ 추천 1 · ${raidTitle(raid)}`);
    expect(msg.embeds[0].fields!.filter((f) => f.name !== '​')).toHaveLength(8);
    expect(allPlaced(msg, plan.candidates[0])).toBe(true);
    expect(msg.embeds[0].description).not.toContain('만 보여요');
    // 6000자 제한 때문에 추천 3개 중 첫 추천만 들어가고, 그 사실을 content에 적는다 (결정적)
    expect(msg.embeds.map((e) => e.title)).toEqual([`⭐ 추천 1 · ${raidTitle(raid)}`]);
    expect(msg.content).toBe(`🏰 ${raidTitle(raid)} 공대 추천 3개를 찾았어요 (길어서 1개만 보여요)`);
  });

  it('공대가 많을 때: 4인 레이드 친구 8명 x 6 → 공대 16개는 다 보이고, 16명 → 공대 32개는 줄였다고 알린다', () => {
    const raid = getRaid('serka-nightmare')!; // 캐릭터가 1765라 세르카는 자동으로 나이트메어 (설계 수정 2026-10-16 A)
    const eight = longRoster();
    const p8 = planRaid({ raid, friends: eight, clears: [], attendeeIds: eight.map((f) => f.id) });
    const m8 = formatPlan(raid, p8, eight, NOW);
    expectValidEmbeds(m8.embeds);
    expect(m8.embeds[0].fields!.filter((f) => f.name !== '​')).toHaveLength(16);
    expect(allPlaced(m8, p8.candidates[0])).toBe(true);

    const sixteen = [...eight, ...longRoster('둘')];
    const p16 = planRaid({ raid, friends: sixteen, clears: [], attendeeIds: sixteen.map((f) => f.id) });
    expect(p16.candidates[0].parties).toHaveLength(32);
    const m16 = formatPlan(raid, p16, sixteen, NOW);
    expectValidEmbeds(m16.embeds);
    const shown = m16.embeds[0].fields!.length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(32);
    expect(m16.embeds[0].description).toContain(`공대 32개 중 ${shown}개만 보여요`);
  });
});

describe('formatPlan: 이번에 못 간 캐릭터 / 모두 편성', () => {
  const raid = getRaid('kazeros-hard')!;
  const longRoster = () => {
    const roles: Character['role'][] = ['dealer', 'dealer', 'support', 'dealer', 'support', 'dealer'];
    return Array.from({ length: 8 }, (_, f) => fr(`f${f}`, `아주아주긴친구표시이름${f}번째`,
      roles.map((role, k) => ch(`캐릭터이름이엄청나게긴캐릭터${f}-${k}`, role, 123456 + f * 1000 + k, 1765.83))));
  };
  const roster = longRoster();
  const base = planRaid({ raid, friends: roster, clears: [], attendeeIds: roster.map((f) => f.id) });
  const names = new Map(roster.map((f) => [f.id, f.displayName]));
  const unplacedMany = roster.flatMap((f) => f.characters.map((c) => ({ friendId: f.id, characterName: `못간${c.name}` })));
  const withUnplaced = (c: Candidate, unplaced: Candidate['unplaced']): Candidate => ({ ...c, unplaced });
  const alt = (c: Candidate): Candidate => ({
    ...c, kind: 'fullPlacement', unplaced: [],
    summary: { ...c.summary, extraExternalVsBest: 3, extraPlacedVsBest: 2 },
  });

  it('unplacedFieldValue: 친구별 한 줄 + 설명, 없으면 null', () => {
    expect(unplacedFieldValue([], names)).toBeNull();
    const v = unplacedFieldValue([
      { friendId: 'f0', characterName: '가' }, { friendId: 'f1', characterName: '나' }, { friendId: 'f0', characterName: '다' },
    ], names)!;
    expect(v.split('\n')).toEqual(['아주아주긴친구표시이름0번째 가, 다', '아주아주긴친구표시이름1번째 나', UNPLACED_NOTE]);
  });

  it('unplacedFieldValue: 길면 들어가는 만큼만 보이고 "외 N개", 설명은 늘 남고, 한도(1024, 예산)를 넘지 않는다', () => {
    for (const budget of [1024, 600, 380, 120]) {
      const v = unplacedFieldValue(unplacedMany, names, budget)!;
      expect(v.length).toBeLessThanOrEqual(budget);
      expect(v.endsWith(UNPLACED_NOTE)).toBe(true);
      const m = v.match(/외 (\d+)개/);
      const listed = v.split('\n').filter((l) => l.startsWith('아주아주')).reduce((n, l) => n + l.split(', ').length, 0);
      expect(m ? Number(m[1]) : 0).toBe(unplacedMany.length - listed);
    }
  });

  it('추천 임베드에 "이번에 못 간 캐릭터" 칸이 공대 칸 뒤에 붙고, 모두 편성은 칸이 없다', () => {
    const plan: PlanResult = { candidates: [withUnplaced(base.candidates[0], unplacedMany.slice(0, 3)), { ...alt(base.candidates[1]), parties: base.candidates[1].parties.slice(0, 2) }], excluded: [] };
    const msg = formatPlan(raid, plan, roster, NOW);
    expectValidEmbeds(msg.embeds);
    expect(msg.embeds).toHaveLength(2);
    const last = msg.embeds[0].fields!.at(-1)!;
    expect(last.name).toBe('이번에 못 간 캐릭터');
    expect(last.value).toContain('아주아주긴친구표시이름0번째 못간캐릭터이름이엄청나게긴캐릭터0-0');
    expect(last.value).toContain(UNPLACED_NOTE);
    expect(msg.embeds[1].fields!.some((f) => f.name === '이번에 못 간 캐릭터')).toBe(false);
  });

  it('작은 입력: 모두 편성 임베드 제목(⭐ 없음), 비교 줄이 설명 맨 앞, 없는 숫자는 뺀다, content에 모두 편성 표시', () => {
    const small = fr('a', '철수', [ch('A1', 'dealer', 3800, 1735), ch('A2', 'dealer', 3000, 1735)]);
    const p = planRaid({ raid: serkaHard, friends: [small], clears: [], attendeeIds: ['a'] });
    const c = p.candidates[0];
    const full = (extra: Partial<Candidate['summary']>): Candidate => ({ ...c, kind: 'fullPlacement', summary: { ...c.summary, ...extra } });
    const both = formatPlan(serkaHard, { candidates: [c, full({ extraExternalVsBest: 3, extraPlacedVsBest: 2 })], excluded: [] }, [small], NOW);
    expectValidEmbeds(both.embeds);
    expect(both.embeds.map((e) => e.title)).toEqual(['⭐ 추천 1 · 세르카 하드', '모두 편성 · 세르카 하드']);
    const d = both.embeds[1].description!.split('\n');
    expect(d[0]).toBe('추천보다 외부 3명 더 필요 · 캐릭터 2개 더 편성');
    expect(d[1]).toMatch(/^친구 \d+명 · 캐릭터 \d+개 편성 · 공대 \d+개/);
    expect(both.content).toBe('🏰 세르카 하드 공대 추천 1개와 모두 편성 1개를 찾았어요');
    const onlyPlaced = formatPlan(serkaHard, { candidates: [c, full({ extraExternalVsBest: 0, extraPlacedVsBest: 1 })], excluded: [] }, [small], NOW);
    expect(onlyPlaced.embeds[1].description!.split('\n')[0]).toBe('추천보다 캐릭터 1개 더 편성');
    const none = formatPlan(serkaHard, { candidates: [c, full({})], excluded: [] }, [small], NOW);
    expect(none.embeds[1].description).not.toContain('추천보다');
  });

  it('추천 번호는 추천만 센다 (추천 1, 추천 2, 모두 편성)', () => {
    const plan: PlanResult = { candidates: [base.candidates[0], base.candidates[1], alt(base.candidates[2])], excluded: [] };
    const titles = formatPlan(raid, plan, roster, NOW).embeds.map((e) => e.title);
    expect(titles[0]).toBe(`⭐ 추천 1 · ${raidTitle(raid)}`);
    expect(titles.every((t) => !t!.startsWith('추천 3') && !t!.includes('⭐ 모두'))).toBe(true);
  });

  it('최악의 경우(공대 8개 + 못 간 캐릭터 48개 + 모두 편성)도 제한 안, 공대는 다 보이고, 모두 편성은 추천 1보다 먼저 빠지며 그 사실을 알린다', () => {
    const plan: PlanResult = {
      candidates: [withUnplaced(base.candidates[0], unplacedMany), base.candidates[1], alt(base.candidates[2])],
      excluded: Array.from({ length: 30 }, (_, i) => ({ friendId: `x${i}`, reason: '가능한 캐릭터 없음' })),
    };
    const msg = formatPlan(raid, plan, roster, NOW);
    expectValidEmbeds(msg.embeds);
    expect(msg.embeds[0].title).toBe(`⭐ 추천 1 · ${raidTitle(raid)}`);
    expect(msg.embeds[0].fields!.filter((f) => /^\d+공대/.test(f.name))).toHaveLength(8);
    expect(msg.embeds.some((e) => e.title?.startsWith('모두 편성'))).toBe(false);
    expect(msg.content).toContain('모두 편성은 길어서 뺐어요');
    // 못 간 캐릭터는 가능한 만큼 보이거나, 못 넣었다면 설명에 적힌다
    const field = msg.embeds[0].fields!.find((f) => f.name === '이번에 못 간 캐릭터');
    expect(field !== undefined || msg.embeds[0].description!.includes('못 간 캐릭터 48개는 길어서 뺐어요')).toBe(true);
  });

  it('공대가 아주 많으면(4인 공대 32개) 못 간 캐릭터 칸을 먼저 빼고, 설명에 적고, 칸 25개 제한을 지킨다', () => {
    const r = getRaid('serka-nightmare')!;
    const sixteen = [...longRoster(), ...longRoster().map((f) => ({ ...f, id: `${f.id}b`, characters: f.characters.map((c) => ({ ...c, name: `${c.name}b` })) }))];
    const p = planRaid({ raid: r, friends: sixteen, clears: [], attendeeIds: sixteen.map((f) => f.id) });
    const plan: PlanResult = { candidates: [withUnplaced(p.candidates[0], unplacedMany), alt(p.candidates[1])], excluded: [] };
    const msg = formatPlan(r, plan, sixteen, NOW);
    expectValidEmbeds(msg.embeds);
    expect(msg.embeds[0].title).toBe(`⭐ 추천 1 · ${raidTitle(r)}`);
    expect(msg.embeds.some((e) => e.title?.startsWith('모두 편성'))).toBe(false);
    expect(msg.embeds[0].fields!.some((f) => f.name === '이번에 못 간 캐릭터')).toBe(false);
    expect(msg.embeds[0].description).toContain('못 간 캐릭터 48개는 길어서 뺐어요');
  });
});

describe('formatStatus', () => {
  it('친구별 필드, 캐릭터별 "레이드 난이도 ✅", 없으면 "-", 꼬리말에 총 N건', () => {
    const friends = [fr('a', '철수', [ch('A1'), ch('A2')])];
    const msg = formatStatus(friends, [
      { characterName: 'A1', raidName: '지평의 성당', difficulty: '1단계' },
      { characterName: 'A1', raidName: '세르카', difficulty: '하드' },
      { characterName: 'ghost', raidName: '세르카', difficulty: '하드' },
    ], NOW);
    expectValidEmbeds(msg.embeds);
    const e = msg.embeds[0];
    expect(e.color).toBe(COLOR.brand);
    expect(e.title).toContain(ICON.status);
    expect(e.fields![0].name).toBe('철수');
    expect(e.fields![0].value).toBe('**A1** · 지평의 성당 1단계 ✅ · 세르카 하드 ✅\n**A2** · -');
    expect(e.footer!.text).toContain('총 2건 클리어');
  });

  it('친구 5명마다 임베드를 나눈다', () => {
    const friends = Array.from({ length: 7 }, (_, i) => fr(`f${i}`, `친구${i}`, [ch(`C${i}`)]));
    const msg = formatStatus(friends, [], NOW);
    expect(msg.embeds.map((e) => e.fields!.length)).toEqual([5, 2]);
    expect(msg.embeds[1].title).toContain('(2/2)');
  });

  it('친구가 없으면 안내 문장', () => {
    const msg = formatStatus([], [], NOW);
    expect(msg.embeds).toEqual([]);
    expect(msg.content).toContain('/등록');
  });
});

describe('기타 메시지', () => {
  it('/명령어 도움말: 묶음별 필드, 모든 명령어와 예시', () => {
    const msg = formatHelp(COMMANDS, NOW);
    expectValidEmbeds(msg.embeds);
    const e = msg.embeds[0];
    expect(e.title).toContain('사용 가능한 명령어');
    expect(e.fields!.map((f) => f.name)).toEqual(['시작하기', '공대 짜기', '클리어 관리']);
    const all = e.fields!.map((f) => f.value).join('\n');
    for (const c of COMMANDS) {
      expect(all).toContain(`/${c.name}`);
      expect(all).toContain(c.description);
    }
    expect(all).toContain('/공대 레이드:세르카 하드');
  });

  it('/등록 성공: 초록 임베드, 역할별 묶음', () => {
    const msg = registerSuccess({ displayName: '철수', representativeName: 'A1', characters: [ch('A1', 'dealer', 1, 1750), ch('A2', 'support', 1, 1760), ch('A3', 'dealer', 1, 1770)], updated: false, now: NOW });
    expectValidEmbeds(msg.embeds);
    const e = msg.embeds[0];
    expect(e.color).toBe(COLOR.success);
    expect(e.description).toContain('캐릭터 3개');
    expect(e.description).toContain('🛡️ 서포터 1 · ⚔️ 딜러 2');
    expect(e.fields!.map((f) => f.name)).toEqual(['🛡️ 서포터 1', '⚔️ 딜러 2']);
    expect(e.fields![1].value.split('\n')[0]).toContain('A3'); // 레벨 높은 순
  });

  it('오류: 빨간 임베드, 원인과 해결 방법', () => {
    const msg = errorParts('캐릭터를 찾을 수 없어요', '철자를 확인해 주세요', NOW);
    expect(msg.content).toBe('캐릭터를 찾을 수 없어요');
    expect(msg.embeds[0].color).toBe(COLOR.error);
    expect(msg.embeds[0].title).toContain('캐릭터를 찾을 수 없어요');
    expect(msg.embeds[0].fields).toEqual([{ name: '해결 방법', value: '철자를 확인해 주세요' }]);
  });

  it('/클리어 요약 임베드', () => {
    const e = characterClearsEmbed(ch('A1'), [{ characterName: 'A1', raidName: '세르카', difficulty: '하드' }], NOW);
    expect(e.description).toBe('✅ 세르카 하드');
    expect(e.color).toBe(COLOR.success);
    expect(characterClearsEmbed(ch('A2'), [], NOW).color).toBe(COLOR.unknown);
  });

  it('LIMITS 값', () => {
    expect(LIMITS).toMatchObject({ title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, embedTotal: 6000, embeds: 10 });
  });
});
