import { describe, it, expect } from 'vitest';
import { planRaid, tierFor, TIGHT_RATIO } from '@/core/planner';
import { getRaid } from '@/core/raids';
import type { Candidate, Character, ClearRecord, Friend, Party, Tier } from '@/core/types';

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
// 순위 키(설계 수정 5번): 외부 서포터 수 → 외부 총 인원 → 최악 단계 → imbalance (사전식 비교용 고정폭 문자열)
const rankKey = (c: Candidate) =>
  [extSupports(c), extTotal(c), worst(c), c.imbalance].map((n) => n.toFixed(3).padStart(12, '0')).join('|');
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

  it('정렬: 외부 서포터 수 → 외부 총 인원 → 최악 단계 → imbalance, imbalance는 공대 평균 최댓값-최솟값', () => {
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
    console.log(`[perf] ${n}명 x 6캐릭터, ${raid.size}인: ${ms.toFixed(1)} ms`);
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

  it('딜러만 8명 x 6캐릭터, 8인 레이드도 1초 안 (공대 수 = 최소)', () => {
    const fs = makeFriends(Object.fromEntries(Array.from({ length: 8 }, (_, f) => [
      `d${f}`, Array.from({ length: 6 }, (_, k): C => [`d${f}-${k}`, 'dealer', 1740, 2500 + ((f * 7 + k * 13) % 20) * 100]),
    ])));
    const t0 = performance.now();
    const r = planRaid({ raid: kazerosHard, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
    const ms = performance.now() - t0;
    console.log(`[perf] 딜러만 8명 x 6캐릭터, 8인: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1000);
    expect(r.candidates[0].parties).toHaveLength(8); // max(친구별 6, ceil(48/6)=8, ceil(48/8)=6)
    expect(r.candidates[0].summary.externalSupports).toBe(16);
  });
});
