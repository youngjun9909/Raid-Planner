import { describe, it, expect } from 'vitest';
import { planRaid, tierFor, TIGHT_RATIO } from '@/core/planner';
import { getRaid } from '@/core/raids';
import type { Candidate, Character, ClearRecord, Friend, Party, Proficiency, Tier } from '@/core/types';

type C = [name: string, role: 'dealer' | 'support', itemLevel: number, combatPower: number | null];
const makeFriends = (spec: Record<string, C[]>): Friend[] =>
  Object.entries(spec).map(([id, chars]) => ({
    id,
    displayName: id.toUpperCase(),
    representativeName: chars[0][0],
    characters: chars.map(([name, role, itemLevel, combatPower]): Character => ({
      name, className: 'x', role, itemLevel, combatPower,
    })),
  }));

// 5명 픽스처: 각 2~3캐릭터, 서포터 2명(b, c)
const friends = makeFriends({
  a: [['a-deal1', 'dealer', 1745, 3900], ['a-deal2', 'dealer', 1735, 3300], ['a-low', 'dealer', 1700, 2000]],
  b: [['b-sup', 'support', 1740, 2500], ['b-deal', 'dealer', 1740, 3700]],
  c: [['c-sup', 'support', 1735, 2400], ['c-deal', 'dealer', 1750, 4000]],
  d: [['d-deal', 'dealer', 1740, 3500], ['d-deal2', 'dealer', 1732, null]],
  e: [['e-deal', 'dealer', 1760, 4200], ['e-cleared', 'dealer', 1760, 4300]],
});
const ALL = ['a', 'b', 'c', 'd', 'e'];
const clears: ClearRecord[] = [{ characterName: 'e-cleared', raidName: '세르카', difficulty: '하드' }];
// 세르카 하드(입장 1730)에 갈 수 있고 아직 안 간 캐릭터 전부: 딜러 7, 서포터 2
const ELIGIBLE = ['a-deal1', 'a-deal2', 'b-deal', 'b-sup', 'c-deal', 'c-sup', 'd-deal', 'd-deal2', 'e-deal'];

const serkaHard = getRaid('serka-hard')!; // 4인, 1730, 권장 3600~4000
const kazerosHard = getRaid('kazeros-hard')!; // 8인, 1730, 권장 3800~4200

const friendSlots = (p: Party) => p.slots.flatMap((s) => (s.kind === 'friend' ? [s] : []));
const roleOf = (s: Party['slots'][number]) => (s.kind === 'friend' ? s.character.role : s.role);
const chosenNames = (c: Candidate) => c.parties.flatMap((p) => friendSlots(p).map((s) => s.character.name));
const BAD: Record<Tier, number> = { comfortable: 0, unknown: 1, tight: 2, risky: 3 };
const worst = (c: Candidate) => Math.max(...c.parties.map((p) => BAD[p.tier]));
const extSupports = (c: Candidate) =>
  c.parties.flatMap((p) => p.slots).filter((s) => s.kind === 'external' && s.role === 'support').length;
const extTotal = (c: Candidate) => c.parties.flatMap((p) => p.slots).filter((s) => s.kind === 'external').length;
const worstCount = (c: Candidate) => c.parties.filter((p) => BAD[p.tier] === worst(c)).length;
// 순위 키(설계 수정 5번): 외부 서포터 수 → 외부 총 인원 → 최악 단계 → 최악 단계 공대 수 → imbalance (사전식 비교용 고정폭 문자열)
const rankKey = (c: Candidate) =>
  [extSupports(c), extTotal(c), worst(c), worstCount(c), c.imbalance].map((n) => n.toFixed(3).padStart(12, '0')).join('|');
// 공대 순서를 무시한 배정 키
const groupingKey = (c: Candidate) =>
  c.parties.map((p) => friendSlots(p).map((s) => s.character.name).sort().join(',')).sort().join(' / ');

describe('tierFor', () => {
  const raid = getRaid('serka-hard')!; // 권장 3600~4000
  it('null → unknown', () => expect(tierFor(null, raid)).toBe('unknown'));
  it('3600 이상 → comfortable', () => expect(tierFor(3600, raid)).toBe('comfortable'));
  it('3240~3599 → tight', () => expect(tierFor(3240, raid)).toBe('tight'));
  it('3239 → risky', () => expect(tierFor(3239, raid)).toBe('risky'));
  it('TIGHT_RATIO는 0.9', () => expect(TIGHT_RATIO).toBe(0.9));
});

describe('planRaid: 여러 공대 편성 규칙', () => {
  it('[헤드라인] 영준(캐릭터 1개) + 현준(캐릭터 2개), 4인 레이드: 1공대 = 영준+현준, 2공대 = 현준의 다른 캐릭터', () => {
    const fs = makeFriends({
      yj: [['영준A', 'dealer', 1740, 3800]],
      hj: [['현준X', 'dealer', 1745, 3700], ['현준Y', 'dealer', 1735, 3600]],
    });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['yj', 'hj'] });
    expect(r.reason).toBeUndefined();
    expect(r.excluded).toEqual([]);
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.parties).toHaveLength(2);
      const ids = c.parties.flatMap((p) => friendSlots(p).map((s) => s.friendId));
      expect(ids.filter((x) => x === 'yj')).toHaveLength(1); // 영준 캐릭터는 한 번만
      expect(c.parties.every((p) => friendSlots(p).some((s) => s.friendId === 'hj'))).toBe(true); // 현준은 두 공대 모두
      const hjChars = c.parties.flatMap((p) => friendSlots(p).filter((s) => s.friendId === 'hj').map((s) => s.character.name));
      expect(hjChars.sort()).toEqual(['현준X', '현준Y']);
      for (const p of c.parties) {
        expect(p.slots).toHaveLength(4); // 외부인으로 4명을 채운다
        expect(p.slots.filter((s) => roleOf(s) === 'support')).toHaveLength(1);
      }
    }
    const top = r.candidates[0];
    // 1공대는 두 사람 공대, 2공대는 현준 혼자 + 외부 3명
    expect(friendSlots(top.parties[0]).map((s) => s.friendId).sort()).toEqual(['hj', 'yj']);
    expect(friendSlots(top.parties[1]).map((s) => s.friendId)).toEqual(['hj']);
    expect(top.summary).toEqual({
      friendCount: 2, characterCount: 3, partyCount: 2, externalCount: 5, externalSupports: 2, externalDealers: 3,
    });
  });

  it('갈 수 있고 아직 안 간 캐릭터는 모든 추천에 정확히 한 번씩 들어간다', () => {
    // 클리어 기록은 세르카 것뿐이라 카제로스에서는 e-cleared도 갈 수 있다
    for (const [raid, expected] of [[serkaHard, ELIGIBLE], [kazerosHard, [...ELIGIBLE, 'e-cleared'].sort()]] as const) {
      const r = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000 });
      expect(r.candidates.length).toBeGreaterThan(1);
      for (const c of r.candidates) expect([...chosenNames(c)].sort()).toEqual(expected);
    }
  });

  it('한 추천 안에서 같은 캐릭터는 두 번 나오지 않는다', () => {
    for (const raid of [serkaHard, kazerosHard]) {
      for (const c of planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000 }).candidates) {
        const names = chosenNames(c);
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });

  it('한 공대 안에 같은 친구는 둘 들어가지 않는다 (다른 공대에는 다른 캐릭터로 들어갈 수 있다)', () => {
    let multiParty = false;
    for (const raid of [serkaHard, kazerosHard]) {
      for (const c of planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000 }).candidates) {
        for (const p of c.parties) {
          const ids = friendSlots(p).map((s) => s.friendId);
          expect(new Set(ids).size).toBe(ids.length);
        }
        const all = c.parties.flatMap((p) => friendSlots(p).map((s) => s.friendId));
        if (new Set(all).size < all.length) multiParty = true;
      }
    }
    expect(multiParty).toBe(true);
  });

  it('입장 레벨 미달/클리어한 캐릭터는 어떤 추천에도 없다', () => {
    const both: ClearRecord[] = [...clears, { characterName: 'e-cleared', raidName: kazerosHard.name, difficulty: '노말' }];
    for (const raid of [serkaHard, kazerosHard]) {
      const all = planRaid({ raid, friends, clears: both, attendeeIds: ALL, limit: 1000 }).candidates.flatMap(chosenNames);
      expect(all).not.toContain('a-low');
      expect(all).not.toContain('e-cleared');
    }
  });

  it('공대 수는 최소: 4인 9캐릭터(딜러 7) → 3개, 8인 → 2개', () => {
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 }).candidates.every((c) => c.parties.length === 3)).toBe(true);
    expect(planRaid({ raid: kazerosHard, friends, clears, attendeeIds: ALL, limit: 1000 }).candidates.every((c) => c.parties.length === 2)).toBe(true);
  });

  it('모든 공대 크기는 raid.size', () => {
    const r4 = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    expect(r4.candidates.flatMap((c) => c.parties).every((p) => p.slots.length === 4)).toBe(true);
    const r8 = planRaid({ raid: kazerosHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    expect(r8.candidates.flatMap((c) => c.parties).every((p) => p.slots.length === 8)).toBe(true);
  });

  it('서포터는 서포터 자리 수만큼만 (4인: 공대당 1, 친구 딜러 ≤3)', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    for (const p of r.candidates.flatMap((c) => c.parties)) {
      expect(p.slots.filter((s) => roleOf(s) === 'support').length).toBe(1);
      expect(friendSlots(p).filter((s) => s.character.role === 'dealer').length).toBeLessThanOrEqual(3);
    }
    // b, c만 참석: 서포터 둘(b-sup, c-sup) + 딜러 둘 → 공대 2개, 공대마다 친구 서포터 1명, 두 사람 모두 두 공대에
    const bc = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ['b', 'c'], limit: 1000 });
    expect(bc.candidates.length).toBeGreaterThan(0);
    for (const c of bc.candidates) {
      expect(c.parties).toHaveLength(2);
      expect([...chosenNames(c)].sort()).toEqual(['b-deal', 'b-sup', 'c-deal', 'c-sup']);
      for (const p of c.parties) {
        expect(friendSlots(p).filter((s) => s.character.role === 'support')).toHaveLength(1);
        expect(friendSlots(p).map((s) => s.friendId).sort()).toEqual(['b', 'c']);
      }
      expect(c.summary.externalSupports).toBe(0);
    }
  });

  it('8인 레이드는 서포터 2자리, 친구 서포터는 모두 쓰인다', () => {
    const r = planRaid({ raid: kazerosHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    for (const c of r.candidates) {
      for (const p of c.parties) expect(p.slots.filter((s) => roleOf(s) === 'support').length).toBe(2);
      expect(chosenNames(c)).toEqual(expect.arrayContaining(['b-sup', 'c-sup']));
      expect(extSupports(c)).toBe(2);
    }
  });

  it('서포터가 없으면 외부 서포터로 채우고 요약에 반영', () => {
    // d(딜러 2) + e(딜러 1) → d가 둘이라 공대 2개
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ['d', 'e'] });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.parties).toHaveLength(2);
      for (const p of c.parties) expect(p.slots).toContainEqual({ kind: 'external', role: 'support' });
      expect(c.summary).toEqual({
        friendCount: 2, characterCount: 3, partyCount: 2, externalCount: 5, externalSupports: 2, externalDealers: 3,
      });
    }
  });

  it('요약 숫자가 맞다 (4인 / 8인)', () => {
    const s4 = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL }).candidates[0].summary;
    expect(s4).toEqual({ friendCount: 5, characterCount: 9, partyCount: 3, externalCount: 3, externalSupports: 1, externalDealers: 2 });
    const s8 = planRaid({ raid: kazerosHard, friends, clears, attendeeIds: ALL }).candidates[0].summary;
    // 카제로스: e-cleared(세르카만 클리어)도 들어가 캐릭터 10개
    expect(s8).toEqual({ friendCount: 5, characterCount: 10, partyCount: 2, externalCount: 6, externalSupports: 2, externalDealers: 4 });
    for (const c of planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 }).candidates) {
      expect(c.summary.externalCount).toBe(extTotal(c));
      expect(c.summary.externalSupports).toBe(extSupports(c));
      expect(c.summary.externalSupports + c.summary.externalDealers).toBe(c.summary.externalCount);
      expect(c.summary.partyCount).toBe(c.parties.length);
      expect(c.summary.characterCount).toBe(chosenNames(c).length);
    }
  });

  it('균형: 강한 딜러 둘 + 약한 딜러 둘을 공대 2개로 → 강한 딜러끼리 묶지 않는다', () => {
    const fs = makeFriends({
      s1: [['s1', 'dealer', 1740, 4500]], s2: [['s2', 'dealer', 1740, 4400]],
      w1: [['w1', 'dealer', 1740, 3000]], w2: [['w2', 'dealer', 1740, 2900]],
    });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['s1', 's2', 'w1', 'w2'] });
    const top = r.candidates[0];
    expect(top.parties).toHaveLength(2);
    const naive = (4500 + 4400) / 2 - (3000 + 2900) / 2; // 1500
    expect(top.imbalance).toBeLessThan(naive);
    expect(top.imbalance).toBe(0); // {4500, 2900} / {4400, 3000} → 둘 다 3700
    for (const p of top.parties) expect(p.tier).toBe('comfortable');
  });

  it('클리어로 가능한 캐릭터가 없는 친구는 excluded에 사유와 함께 들어간다', () => {
    const allCleared: ClearRecord[] = [...clears, { characterName: 'e-deal', raidName: '세르카', difficulty: '노말' }];
    const r = planRaid({ raid: serkaHard, friends, clears: allCleared, attendeeIds: ALL });
    expect(r.excluded).toEqual([{ friendId: 'e', reason: '가능한 캐릭터 없음' }]);
    expect(r.candidates.flatMap((c) => c.parties.flatMap(friendSlots)).some((s) => s.friendId === 'e')).toBe(false);
    // 남은 a,b,c,d의 캐릭터 8개(딜러 6, 서포터 2) → 공대 2개
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.parties.length === 2 && c.summary.friendCount === 4)).toBe(true);
  });

  it('서포터만 있는 공대는 dealerAvgCP null, tier unknown, 예외 없음', () => {
    const sOnly = makeFriends({ s: [['s-sup', 'support', 1740, 2600]] });
    const r = planRaid({ raid: serkaHard, friends: sOnly, clears: [], attendeeIds: ['s'] });
    expect(r.candidates).toHaveLength(1);
    const p = r.candidates[0].parties[0];
    expect(p.dealerAvgCP).toBeNull();
    expect(p.tier).toBe('unknown');
    expect(r.candidates[0].summary.externalCount).toBe(3);
    expect(r.candidates[0].imbalance).toBe(0);
  });

  it('combatPower null 딜러는 평균에서 빠지고 평균이 NaN이 아니다', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ['a', 'd'], limit: 1000 });
    for (const p of r.candidates.flatMap((c) => c.parties)) {
      expect(p.dealerAvgCP === null || Number.isFinite(p.dealerAvgCP)).toBe(true);
    }
    const party = r.candidates.flatMap((c) => c.parties).find((p) =>
      friendSlots(p).map((s) => s.character.name).sort().join() === 'a-deal1,d-deal2');
    expect(party?.dealerAvgCP).toBe(3900);
    const onlyNull = planRaid({ raid: serkaHard, friends: makeFriends({ n: [['n-deal', 'dealer', 1740, null]] }), clears: [], attendeeIds: ['n'] });
    expect(onlyNull.candidates[0].parties[0].dealerAvgCP).toBeNull();
    expect(onlyNull.candidates[0].parties[0].tier).toBe('unknown');
  });

  it('참석자 0명이면 candidates [] 이고 예외 없음, reason 없음', () => {
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: [] })).toEqual({ candidates: [], excluded: [] });
  });

  it('정렬: 외부 서포터 수 → 외부 총 인원 → 최악 단계 → 최악 단계 공대 수 → imbalance, imbalance는 공대 평균 최댓값-최솟값', () => {
    for (const raid of [serkaHard, kazerosHard]) {
      const r = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000 });
      expect(r.candidates.length).toBeGreaterThan(5);
      for (let i = 1; i < r.candidates.length; i++) {
        expect(rankKey(r.candidates[i - 1]) <= rankKey(r.candidates[i])).toBe(true);
      }
      for (const c of r.candidates) {
        const avgs = c.parties.map((p) => p.dealerAvgCP).filter((v): v is number => v !== null);
        expect(c.imbalance).toBe(avgs.length ? Math.max(...avgs) - Math.min(...avgs) : 0);
      }
    }
  });

  it('공대 순서만 다른 같은 배정은 중복 제거된다', () => {
    for (const raid of [serkaHard, kazerosHard]) {
      const keys = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000 }).candidates.map(groupingKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('limit 기본값 3', () => {
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL }).candidates).toHaveLength(3);
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 2 }).candidates).toHaveLength(2);
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 5 }).candidates).toHaveLength(5);
  });

  it('같은 입력이면 같은 결과 (결정적)', () => {
    for (const raid of [serkaHard, kazerosHard]) {
      const a = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 50 });
      const b = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 50 });
      expect(b).toEqual(a);
    }
  });

  it('딜러만 4명이 4인 레이드: 공대 2개, 공대마다 외부 서포터', () => {
    const dealers = makeFriends({
      w: [['w1', 'dealer', 1740, 3600]], x: [['x1', 'dealer', 1740, 3600]],
      y: [['y1', 'dealer', 1740, 3600]], z: [['z1', 'dealer', 1740, 3600]],
    });
    const r = planRaid({ raid: serkaHard, friends: dealers, clears: [], attendeeIds: ['w', 'x', 'y', 'z'] });
    expect(r.reason).toBeUndefined();
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.parties).toHaveLength(2);
      for (const p of c.parties) {
        expect(p.slots).toHaveLength(4);
        expect(p.slots.filter((sl) => sl.kind === 'external' && sl.role === 'support')).toHaveLength(1);
      }
      expect(c.summary.externalCount).toBe(4);
      expect(c.parties.flatMap((p) => friendSlots(p).map((s) => s.friendId)).sort()).toEqual(['w', 'x', 'y', 'z']);
    }
  });

  it('서포터만 4명이 4인 레이드: 서포터 자리가 1개라 공대 4개 (공대마다 서포터 1 + 외부 딜러 3)', () => {
    const supports = makeFriends({
      w: [['w1', 'support', 1740, 2000]], x: [['x1', 'support', 1740, 2000]],
      y: [['y1', 'support', 1740, 2000]], z: [['z1', 'support', 1740, 2000]],
    });
    const r = planRaid({ raid: serkaHard, friends: supports, clears: [], attendeeIds: ['w', 'x', 'y', 'z'] });
    expect(r.reason).toBeUndefined();
    expect(r.candidates).toHaveLength(1); // 공대 순서만 다른 배정은 하나뿐
    const c = r.candidates[0];
    expect(c.parties).toHaveLength(4);
    for (const p of c.parties) {
      expect(friendSlots(p)).toHaveLength(1);
      expect(p.tier).toBe('unknown');
      expect(p.slots.filter((s) => s.kind === 'external' && s.role === 'dealer')).toHaveLength(3);
    }
    expect(c.summary).toEqual({ friendCount: 4, characterCount: 4, partyCount: 4, externalCount: 12, externalSupports: 0, externalDealers: 12 });
  });

  it('친구 한 명이 캐릭터 3개면 공대 3개 (캐릭터마다 다른 공대)', () => {
    const fs = makeFriends({ m: [['m1', 'dealer', 1740, 3600], ['m2', 'dealer', 1740, 3500], ['m3', 'support', 1740, 2000]] });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['m'] });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].parties).toHaveLength(3);
    for (const p of r.candidates[0].parties) expect(friendSlots(p)).toHaveLength(1);
  });

  it('참석자 모두 가능한 캐릭터가 없으면 그 사유를 알려 준다', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ['e'], limit: 5 });
    const allCleared = planRaid({
      raid: serkaHard, friends, attendeeIds: ['e'],
      clears: [...clears, { characterName: 'e-deal', raidName: '세르카', difficulty: '하드' }],
    });
    expect(r.reason).toBeUndefined();
    expect(allCleared.candidates).toEqual([]);
    expect(allCleared.excluded).toHaveLength(1);
    expect(allCleared.reason).toBe('참석할 수 있는 캐릭터가 없어요');
  });

  it('두 친구가 같은 캐릭터 이름을 가지면 먼저 나온 친구의 것만 쓴다', () => {
    const dup = makeFriends({
      p: [['same', 'dealer', 1740, 4000], ['p-sup', 'support', 1740, 2500]],
      q: [['same', 'dealer', 1740, 4000]],
      r: [['r1', 'dealer', 1740, 3700]],
    });
    const res = planRaid({ raid: serkaHard, friends: dup, clears: [], attendeeIds: ['p', 'q', 'r'] });
    expect(res.candidates.length).toBeGreaterThan(0);
    for (const c of res.candidates) {
      const names = chosenNames(c);
      expect(new Set(names).size).toBe(names.length);
      expect(c.parties.flatMap((p) => p.slots).some((s) => s.kind === 'friend' && s.friendId === 'q')).toBe(false);
    }
    expect(res.excluded).toEqual([{ friendId: 'q', reason: '가능한 캐릭터 없음' }]);
  });

  it('후보가 있으면 reason 없음', () => {
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL }).reason).toBeUndefined();
  });
});

describe('planRaid: 편성 품질 (서포터가 섞인 교환, 최악 단계 공대 수)', () => {
  it('[회귀] 같은 친구의 딜러와 서포터를 공대끼리 바꿔야 위험 공대가 없어지는 경우도 찾는다 (8인)', () => {
    const fs = makeFriends({
      A: [['A-sup1', 'support', 1740, 2000], ['A-weak', 'dealer', 1740, 3350], ['A-sup2', 'support', 1740, 2000]],
      B: [['B-strong', 'dealer', 1740, 4600], ['B-weak', 'dealer', 1740, 3350], ['B-sup', 'support', 1740, 2000]],
      C: [['C-strong', 'dealer', 1740, 4300]],
    });
    const r = planRaid({ raid: kazerosHard, friends: fs, clears: [], attendeeIds: ['A', 'B', 'C'] });
    const top = r.candidates[0];
    expect(top.parties).toHaveLength(3);
    expect(top.parties.some((p) => p.tier === 'risky')).toBe(false);
    expect(top.parties.filter((p) => p.tier === 'comfortable')).toHaveLength(2);
  });

  it('최악 단계가 같으면 그 단계인 공대가 적은 편성이 앞선다 (균형보다 먼저)', () => {
    // 4인, 딜러 6명 → 공대 2개(3+3). 어느 배정이든 위험 공대가 있다(합 17,900 / 2 < 3,240).
    // 가장 고르게 나누면 둘 다 위험, {4400,3300,3200}=3,633(여유) / 나머지(위험)로 나누면 위험 공대는 하나.
    const fs = makeFriends({
      a: [['a', 'dealer', 1740, 4400]], b: [['b', 'dealer', 1740, 3300]], c: [['c', 'dealer', 1740, 3200]],
      d: [['d', 'dealer', 1740, 3000]], e: [['e', 'dealer', 1740, 2000]], f: [['f', 'dealer', 1740, 2000]],
    });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['a', 'b', 'c', 'd', 'e', 'f'], limit: 50 });
    const top = r.candidates[0];
    expect(top.parties.filter((p) => p.tier === 'risky')).toHaveLength(1);
    // 둘 다 위험인(더 고른) 편성도 후보에는 있지만 뒤에 온다
    const bothRisky = r.candidates.findIndex((c) => c.parties.every((p) => p.tier === 'risky'));
    expect(bothRisky).toBeGreaterThan(0);
    expect(r.candidates[bothRisky].imbalance).toBeLessThan(top.imbalance);
  });

  // 아주 작은 입력에서 가능한 모든 배정을 다 펼쳐 본 최적과 비교 (고정 시드)
  const mulberry = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** 같은 규칙(공대 수 최소, 역할 자리, 한 공대에 같은 친구 한 번, 빈 공대 없음)으로 가능한 배정 중 최악 단계의 최솟값. */
  const bruteForceBestWorst = (fs: Friend[], raid: typeof serkaHard): number | null => {
    const items = fs.flatMap((f) => f.characters.map((c) => ({ f: f.id, c })));
    const ss = raid.size / 4;
    const ds = raid.size - ss;
    const sup = items.filter((x) => x.c.role === 'support').length;
    const P = Math.max(1, ...fs.map((f) => f.characters.length), Math.ceil((items.length - sup) / ds), Math.ceil(sup / ss), Math.ceil(items.length / raid.size));
    const parties: (typeof items)[] = Array.from({ length: P }, () => []);
    let best: number | null = null;
    const walk = (k: number, used: number) => {
      if (k === items.length) {
        if (parties.some((p) => p.length === 0)) return;
        const w = Math.max(...parties.map((p) => {
          const cps = p.flatMap((x) => (x.c.role === 'dealer' && x.c.combatPower !== null ? [x.c.combatPower] : []));
          return BAD[tierFor(cps.length ? cps.reduce((a, b) => a + b, 0) / cps.length : null, raid)];
        }));
        if (best === null || w < best) best = w;
        return;
      }
      const it = items[k];
      for (let p = 0; p < Math.min(P, used + 1); p++) { // 공대 순서 대칭 제거
        const g = parties[p];
        if (g.some((x) => x.f === it.f)) continue;
        const isSup = it.c.role === 'support';
        if (g.filter((x) => (x.c.role === 'support') === isSup).length >= (isSup ? ss : ds)) continue;
        g.push(it);
        walk(k + 1, Math.max(used, p + 1));
        g.pop();
      }
    };
    walk(0, 0);
    return best;
  };

  it('작은 무작위 입력 300개(캐릭터 ≤8, 고정 시드): 1순위 추천의 최악 단계는 완전 탐색 최적보다 나쁘지 않다', () => {
    const rand = mulberry(20261016);
    let checked = 0;
    for (let n = 0; n < 300; n++) {
      const raid = rand() < 0.5 ? serkaHard : kazerosHard;
      const friendCount = 2 + Math.floor(rand() * 3);
      const spec: Record<string, C[]> = {};
      let total = 0;
      for (let f = 0; f < friendCount && total < 8; f++) {
        const k = Math.min(1 + Math.floor(rand() * 3), 8 - total);
        total += k;
        spec[`r${f}`] = Array.from({ length: k }, (_, j): C => {
          const support = rand() < 0.3;
          const cp = rand() < 0.1 ? null : 2800 + Math.round(rand() * 18) * 100;
          return [`r${f}-${j}`, support ? 'support' : 'dealer', 1740, cp];
        });
      }
      const fs = makeFriends(spec);
      const best = bruteForceBestWorst(fs, raid);
      const r = planRaid({ raid, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
      if (best === null) continue;
      checked++;
      expect({ case: n, worst: worst(r.candidates[0]) }).toEqual({ case: n, worst: best });
    }
    expect(checked).toBeGreaterThan(250);
  });
});

describe('planRaid: 성능', () => {
  const bigFriends = (n: number): Friend[] => {
    const roles: ('dealer' | 'support')[] = ['dealer', 'dealer', 'support', 'dealer', 'support', 'dealer'];
    return makeFriends(
      Object.fromEntries(
        Array.from({ length: n }, (_, f) => [
          `p${f}`,
          roles.map((role, k): C => [`p${f}-${k}`, role, 1740 + k, 3000 + f * 97 + k * 131]),
        ]),
      ),
    );
  };
  const timed = (raid: typeof serkaHard, n: number) => {
    const big = bigFriends(n);
    const t0 = performance.now();
    const r = planRaid({ raid, friends: big, clears: [], attendeeIds: big.map((f) => f.id) });
    const ms = performance.now() - t0;
    return { r, ms };
  };
  const checkAll = (r: ReturnType<typeof planRaid>, n: number, parties: number) => {
    expect(r.candidates).toHaveLength(3);
    for (const c of r.candidates) {
      expect(c.parties).toHaveLength(parties);
      expect(chosenNames(c)).toHaveLength(n * 6);
      expect(new Set(chosenNames(c)).size).toBe(n * 6);
      for (const p of c.parties) {
        const ids = friendSlots(p).map((s) => s.friendId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  };

  it('8명 x 6캐릭터 (서포터 16): 8인 레이드 공대 8개, 4인 레이드 공대 16개, 각각 1초 안', () => {
    const k = timed(kazerosHard, 8);
    checkAll(k.r, 8, 8);
    expect(k.ms).toBeLessThan(1000);
    const s = timed(serkaHard, 8);
    checkAll(s.r, 8, 16);
    expect(s.ms).toBeLessThan(1000);
  });

  it('16명 x 6캐릭터: 8인 레이드 공대 16개, 4인 레이드 공대 32개, 각각 3초 안', () => {
    const k = timed(kazerosHard, 16);
    checkAll(k.r, 16, 16);
    expect(k.ms).toBeLessThan(3000);
    const s = timed(serkaHard, 16);
    checkAll(s.r, 16, 32);
    expect(s.ms).toBeLessThan(3000);
  });

  it('숙련도가 섞여도(고정 시드 무작위) 8명 x 6은 1초, 16명 x 6은 3초 안, 규칙과 숙련도 요약이 맞다', () => {
    const levels = ['숙련', '반숙', '클경'] as const;
    for (const [n, limitMs] of [[8, 1000], [16, 3000]] as const) {
      const big = bigFriends(n);
      const rand = rngFor(n * 1000 + 7);
      const m = new Map(big.flatMap((f) => f.characters.map((c) => [c.name, levels[Math.floor(rand() * 3)]] as const)));
      for (const [raid, parties] of [[kazerosHard, n], [serkaHard, n * 2]] as const) {
        const t0 = performance.now();
        const r = planRaid({ raid, friends: big, clears: [], attendeeIds: big.map((f) => f.id), proficiency: (_f, name) => m.get(name)! });
        const ms = performance.now() - t0;
        expect(ms).toBeLessThan(limitMs);
        checkAll(r, n, parties);
        for (const p of r.candidates.flatMap((c) => c.parties)) {
          const fsl = p.slots.flatMap((s) => (s.kind === 'friend' ? [s] : []));
          expect(fsl.every((s) => s.proficiency === m.get(s.character.name))).toBe(true);
          expect(p.proficiency!.숙련 + p.proficiency!.반숙 + p.proficiency!.클경).toBe(fsl.length);
        }
        // 숙련자가 공대 수보다 많으면 숙련자 없는 공대가 없어야 한다
        const experts = [...m.values()].filter((v) => v === '숙련').length;
        if (experts >= parties) expect(r.candidates[0].parties.every((p) => !p.proficiency!.noExpert)).toBe(true);
      }
    }
  });

  it('딜러만 8명 x 6캐릭터, 8인 레이드도 1초 안 (공대 수 = 최소)', () => {
    const fs = makeFriends(Object.fromEntries(Array.from({ length: 8 }, (_, f) => [
      `d${f}`, Array.from({ length: 6 }, (_, k): C => [`d${f}-${k}`, 'dealer', 1740, 2500 + ((f * 7 + k * 13) % 20) * 100]),
    ])));
    const t0 = performance.now();
    const r = planRaid({ raid: kazerosHard, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(r.candidates[0].parties).toHaveLength(8); // max(친구별 6, ceil(48/6)=8, ceil(48/8)=6)
    expect(r.candidates[0].summary.externalSupports).toBe(16);
  });
});

describe('planRaid: 숙련도 (설계 수정 2026-10-16-proficiency-amendment.md)', () => {
  const serkaNormal = getRaid('serka-normal')!; // 4인, 1710, 권장 2300~2500 (아래 전투력이면 모든 공대가 여유)
  type L = Proficiency;
  const lookup = (m: Record<string, L>) => (_f: string, name: string): L => m[name] ?? '반숙';
  const profOf = (s: Party['slots'][number]) => (s.kind === 'friend' ? s.proficiency : undefined);
  const count = (p: Party, l: L) => friendSlots(p).filter((s) => s.proficiency === l).length;
  const DEV: Record<L, number> = { 숙련: 1, 반숙: 0, 클경: -1 };
  const noExpertParties = (c: Candidate) => c.parties.filter((p) => count(p, '숙련') === 0).length;
  const multiClkParties = (c: Candidate) => c.parties.filter((p) => count(p, '클경') >= 2).length;
  const devRange = (c: Candidate) => {
    const v = c.parties.map((p) => friendSlots(p).reduce((s, x) => s + DEV[x.proficiency!], 0));
    return Math.max(...v) - Math.min(...v);
  };
  // 순위 키: 외부 서포터 → 외부 총 인원 → 최악 단계 → 그 단계 공대 수 → 숙련자 없는 공대 수 → 클경 2명 이상 공대 수 → 숙련도 점수 차 → imbalance
  const profRankKey = (c: Candidate) =>
    [extSupports(c), extTotal(c), worst(c), worstCount(c), noExpertParties(c), multiClkParties(c), devRange(c), c.imbalance]
      .map((n) => n.toFixed(3).padStart(12, '0')).join('|');
  const singles = (ids: string[]) =>
    makeFriends(Object.fromEntries(ids.map((id) => [id, [[`${id}1`, 'dealer', 1740, 3000]] as C[]])));

  // 전투력만 보면 숙련 둘(e1, e2)이 한 공대에 묶이는 편이 균형이 가장 좋다 ({4500,2900} / {4400,3000} = 둘 다 3,700)
  const four = makeFriends({
    e1: [['e1', 'dealer', 1740, 4500]], e2: [['e2', 'dealer', 1740, 2900]],
    k1: [['k1', 'dealer', 1740, 4400]], k2: [['k2', 'dealer', 1740, 3000]],
  });
  const fourIds = ['e1', 'e2', 'k1', 'k2'];
  const fourProf = lookup({ e1: '숙련', e2: '숙련', k1: '클경', k2: '클경' });
  const together = (c: Candidate) => c.parties.some((p) => count(p, '숙련') === 2);

  it('숙련도를 주지 않으면 모두 반숙: 친구 자리에 반숙, 공대 요약은 숙련 0 (숙련자 없음), 전투력 균형은 그대로', () => {
    const r = planRaid({ raid: serkaNormal, friends: four, clears: [], attendeeIds: fourIds });
    const top = r.candidates[0];
    for (const p of top.parties) {
      expect(friendSlots(p).every((s) => s.proficiency === '반숙')).toBe(true);
      expect(p.proficiency).toEqual({ 숙련: 0, 반숙: friendSlots(p).length, 클경: 0, noExpert: true });
    }
    expect(top.imbalance).toBe(0);
  });

  it('(a) 숙련 2 + 클경 2, 공대 2개 → 공대마다 숙련 1명, 클경도 1명씩 (전투력 균형보다 먼저)', () => {
    const r = planRaid({ raid: serkaNormal, friends: four, clears: [], attendeeIds: fourIds, proficiency: fourProf });
    const top = r.candidates[0];
    expect(top.parties).toHaveLength(2);
    for (const p of top.parties) {
      expect(p.tier).toBe('comfortable');
      expect(count(p, '숙련')).toBe(1);
      expect(count(p, '클경')).toBe(1);
      expect(p.proficiency).toEqual({ 숙련: 1, 반숙: 0, 클경: 1, noExpert: false });
    }
    expect(top.imbalance).toBeGreaterThan(0);
  });

  it('(b) 단계·외부 인원이 같으면 숙련자를 한 공대에 모은 편성은 나눈 편성보다 항상 뒤에 온다', () => {
    const r = planRaid({ raid: serkaNormal, friends: four, clears: [], attendeeIds: fourIds, proficiency: fourProf, limit: 1000 });
    const flags = r.candidates.map(together);
    expect(flags.includes(true)).toBe(true);
    expect(flags.includes(false)).toBe(true);
    expect(flags.indexOf(true)).toBeGreaterThan(flags.lastIndexOf(false));
    expect(r.candidates.find(together)!.parties.some((p) => p.proficiency!.noExpert)).toBe(true);
  });

  it('(c) 외부 자리는 숙련자로 세지 않는다 (외부인만 있는 공대 = 숙련자 없음)', () => {
    // m은 캐릭터 2개(공대 2개), 숙련은 x1 하나뿐 → 한 공대는 숙련자가 없을 수밖에 없다
    const fs = makeFriends({ x: [['x1', 'dealer', 1740, 3000]], m: [['m1', 'dealer', 1740, 3000], ['m2', 'dealer', 1740, 3000]] });
    const r = planRaid({ raid: serkaNormal, friends: fs, clears: [], attendeeIds: ['x', 'm'], proficiency: lookup({ x1: '숙련' }), limit: 50 });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.parties.filter((p) => p.proficiency!.noExpert)).toHaveLength(1);
      for (const p of c.parties) {
        const s = p.proficiency!;
        expect(s.숙련 + s.반숙 + s.클경).toBe(friendSlots(p).length);
        expect(p.slots.filter((x) => x.kind === 'external').every((x) => profOf(x) === undefined)).toBe(true);
      }
    }
  });

  it('클경은 공대마다 한 명 이하로 나누고, 공대 수보다 많으면 둘 이상도 허용한다 (막지 않는다)', () => {
    const fs = singles(['a', 'b', 'c', 'd', 'e', 'f']);
    const ids = fs.map((f) => f.id);
    const two = planRaid({ raid: serkaNormal, friends: fs, clears: [], attendeeIds: ids, proficiency: lookup({ a1: '클경', b1: '클경' }) });
    expect(two.candidates[0].parties.map((p) => count(p, '클경'))).toEqual([1, 1]);
    const three = planRaid({ raid: serkaNormal, friends: fs, clears: [], attendeeIds: ids, proficiency: lookup({ a1: '클경', b1: '클경', c1: '클경' }) });
    expect(three.candidates.length).toBeGreaterThan(0);
    expect(three.candidates[0].parties.map((p) => count(p, '클경')).sort()).toEqual([1, 2]);
  });

  it('숙련도 점수 차(공대별 숙련 +1, 반숙 0, 클경 −1의 합의 최대−최소)가 작은 편성이 앞선다', () => {
    // 숙련 3 + 클경 1 + 반숙 2, 공대 2개: {숙련,숙련,클경}=+1 / {숙련,반숙,반숙}=+1 → 차 0이 최선
    const fs = singles(['a', 'b', 'c', 'd', 'e', 'f']);
    const r = planRaid({
      raid: serkaNormal, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id),
      proficiency: lookup({ a1: '숙련', b1: '숙련', c1: '숙련', d1: '클경' }),
    });
    const top = r.candidates[0];
    expect(noExpertParties(top)).toBe(0);
    expect(devRange(top)).toBe(0);
  });

  it('[정렬] 숙련도가 섞여도 순위 키(외부 → 단계 → 숙련도 균형 → imbalance)대로 정렬된다', () => {
    const rand = rngFor(77);
    const levels: L[] = ['숙련', '반숙', '클경'];
    const m: Record<string, L> = {};
    for (const f of friends) for (const c of f.characters) m[c.name] = levels[Math.floor(rand() * 3)];
    for (const raid of [serkaHard, kazerosHard]) {
      const r = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000, proficiency: lookup(m) });
      expect(r.candidates.length).toBeGreaterThan(5);
      for (let i = 1; i < r.candidates.length; i++) {
        expect(profRankKey(r.candidates[i - 1]) <= profRankKey(r.candidates[i])).toBe(true);
      }
    }
  });

  it('(d) 같은 입력이면 같은 결과 (숙련도 포함, 결정적)', () => {
    const m: Record<string, L> = { 'a-deal1': '숙련', 'b-sup': '숙련', 'c-deal': '클경', 'd-deal': '클경', 'e-deal': '숙련' };
    for (const raid of [serkaHard, kazerosHard]) {
      const a = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 50, proficiency: lookup(m) });
      const b = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 50, proficiency: lookup(m) });
      expect(b).toEqual(a);
    }
  });

  it('숙련도 조회는 그 친구 id와 캐릭터 이름으로 부른다', () => {
    const seen: string[] = [];
    planRaid({ raid: serkaHard, friends, clears, attendeeIds: ['b', 'c'], proficiency: (f, n) => { seen.push(`${f}/${n}`); return '반숙'; } });
    expect([...new Set(seen)].sort()).toEqual(['b/b-deal', 'b/b-sup', 'c/c-deal', 'c/c-sup']);
  });

  /** 순위대로(최악 단계 → 그 단계 공대 수 → 숙련자 없는 공대 수) 가장 좋은 배정의 값 (작은 입력 완전 탐색). */
  function bruteForce(fs: Friend[], raid: typeof serkaHard, m: Record<string, L>): { worst: number; worstCount: number; noExpert: number } | null {
    const items = fs.flatMap((f) => f.characters.map((c) => ({ f: f.id, c })));
    const ss = raid.size / 4;
    const ds = raid.size - ss;
    const sup = items.filter((x) => x.c.role === 'support').length;
    const P = Math.max(1, ...fs.map((f) => f.characters.length), Math.ceil((items.length - sup) / ds), Math.ceil(sup / ss), Math.ceil(items.length / raid.size));
    const parties: (typeof items)[] = Array.from({ length: P }, () => []);
    let best: { worst: number; worstCount: number; noExpert: number } | null = null;
    const walk = (k: number, used: number) => {
      if (k === items.length) {
        if (parties.some((p) => p.length === 0)) return;
        const tiers = parties.map((p) => {
          const cps = p.flatMap((x) => (x.c.role === 'dealer' && x.c.combatPower !== null ? [x.c.combatPower] : []));
          return BAD[tierFor(cps.length ? cps.reduce((a, b) => a + b, 0) / cps.length : null, raid)];
        });
        const w = Math.max(...tiers);
        const cand = { worst: w, worstCount: tiers.filter((t) => t === w).length, noExpert: parties.filter((p) => !p.some((x) => m[x.c.name] === '숙련')).length };
        if (!best || cand.worst - best.worst || cand.worstCount - best.worstCount || cand.noExpert - best.noExpert) {
          if (!best || cand.worst < best.worst || (cand.worst === best.worst && (cand.worstCount < best.worstCount
            || (cand.worstCount === best.worstCount && cand.noExpert < best.noExpert)))) best = cand;
        }
        return;
      }
      const it = items[k];
      for (let p = 0; p < Math.min(P, used + 1); p++) {
        const g = parties[p];
        if (g.some((x) => x.f === it.f)) continue;
        const isSup = it.c.role === 'support';
        if (g.filter((x) => (x.c.role === 'support') === isSup).length >= (isSup ? ss : ds)) continue;
        g.push(it);
        walk(k + 1, Math.max(used, p + 1));
        g.pop();
      }
    };
    walk(0, 0);
    return best;
  }

  it('(e) 무작위 입력 300개 + 무작위 숙련도(고정 시드): 규칙(캐릭터 한 번씩, 한 공대에 같은 친구 없음, 역할 자리, 최소 공대 수)과 숙련도 요약이 맞고, 1순위의 최악 단계는 완전 탐색 최적과 같다', () => {
    const rand = rngFor(4242);
    const levels: L[] = ['숙련', '반숙', '클경'];
    let checked = 0;
    let expertOptimal = 0;
    for (let n = 0; n < 300; n++) {
      const raid = rand() < 0.5 ? serkaHard : kazerosHard;
      const friendCount = 2 + Math.floor(rand() * 3);
      const spec: Record<string, C[]> = {};
      const m: Record<string, L> = {};
      let total = 0;
      for (let f = 0; f < friendCount && total < 8; f++) {
        const k = Math.min(1 + Math.floor(rand() * 3), 8 - total);
        total += k;
        spec[`r${f}`] = Array.from({ length: k }, (_, j): C => {
          const support = rand() < 0.3;
          const cp = rand() < 0.1 ? null : 2800 + Math.round(rand() * 18) * 100;
          m[`r${f}-${j}`] = levels[Math.floor(rand() * 3)];
          return [`r${f}-${j}`, support ? 'support' : 'dealer', 1740, cp];
        });
      }
      const fs = makeFriends(spec);
      const r = planRaid({ raid, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id), limit: 20, proficiency: lookup(m) });
      const items = fs.flatMap((f) => f.characters);
      const ss = raid.size / 4;
      const sup = items.filter((c) => c.role === 'support').length;
      const minP = Math.max(1, ...fs.map((f) => f.characters.length), Math.ceil((items.length - sup) / (raid.size - ss)), Math.ceil(sup / ss), Math.ceil(items.length / raid.size));
      expect(r.candidates.length).toBeGreaterThan(0);
      for (const c of r.candidates) {
        expect([...chosenNames(c)].sort()).toEqual(items.map((x) => x.name).sort());
        expect(c.parties).toHaveLength(minP);
        for (const p of c.parties) {
          expect(p.slots).toHaveLength(raid.size);
          const ids = friendSlots(p).map((s) => s.friendId);
          expect(new Set(ids).size).toBe(ids.length);
          expect(p.slots.filter((s) => roleOf(s) === 'support')).toHaveLength(ss);
          for (const s of friendSlots(p)) expect(s.proficiency).toBe(m[s.character.name]);
          expect(p.proficiency).toEqual({ 숙련: count(p, '숙련'), 반숙: count(p, '반숙'), 클경: count(p, '클경'), noExpert: count(p, '숙련') === 0 });
        }
      }
      const best = bruteForce(fs, raid, m);
      if (!best) continue;
      checked++;
      const top = r.candidates[0];
      expect({ case: n, worst: worst(top) }).toEqual({ case: n, worst: best.worst });
      if (worstCount(top) === best.worstCount && noExpertParties(top) === best.noExpert) expertOptimal++;
    }
    expect(checked).toBeGreaterThan(250);
    // 숙련자 배치도 (단계가 같은 한) 거의 항상 최적이어야 한다
    expect(expertOptimal / checked).toBeGreaterThan(0.97);
  });
});

function rngFor(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
