import { describe, it, expect } from 'vitest';
import { planRaid, tierFor, TIGHT_RATIO } from '@/core/planner';
import { getRaid, RAIDS } from '@/core/raids';
import { difficultiesOf, effectiveDifficulty, SKIP_DIFFICULTY } from '@/core/difficulty';
import type { Candidate, Character, ClearRecord, Friend, Party, PlanResult, Proficiency, RaidConfig, Tier } from '@/core/types';

/*
 * 편성 규칙 (설계 수정 2026-10-16-friend-first-amendment.md C):
 * 후보 캐릭터를 전부 편성하지 않고, 공대마다 친구 캐릭터가 t명 이상(4인 3 → 2 → 1, 8인 6 → 4 → 1)인 공대만 만든다.
 * 순위: ① 편성된 캐릭터 수 많이 → ② 외부 총 인원 적게 → ③ 외부 서포터 적게 → ④ 최악 단계 → ⑤ 그 단계 공대 수 →
 * ⑥ 숙련도 균형 → ⑦ 전투력 차.
 *
 * 레벨: 세르카 하드(1730)/종막 하드(1730) 픽스처는 1730~1739 (자동 가는 난이도가 하드가 되도록; 1740이면 세르카는 나이트메어),
 * 세르카 노말(1710) 픽스처는 1715.
 */

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
  a: [['a-deal1', 'dealer', 1739, 3900], ['a-deal2', 'dealer', 1735, 3300], ['a-low', 'dealer', 1700, 2000]],
  b: [['b-sup', 'support', 1736, 2500], ['b-deal', 'dealer', 1737, 3700]],
  c: [['c-sup', 'support', 1735, 2400], ['c-deal', 'dealer', 1738, 4000]],
  d: [['d-deal', 'dealer', 1736, 3500], ['d-deal2', 'dealer', 1732, null]],
  e: [['e-deal', 'dealer', 1739, 4200], ['e-cleared', 'dealer', 1739, 4300]],
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
const unplacedNames = (c: Candidate) => c.unplaced.map((u) => u.characterName);
const BAD: Record<Tier, number> = { comfortable: 0, unknown: 1, tight: 2, risky: 3 };
const worst = (c: Candidate) => Math.max(...c.parties.map((p) => BAD[p.tier]));
const extSupports = (c: Candidate) =>
  c.parties.flatMap((p) => p.slots).filter((s) => s.kind === 'external' && s.role === 'support').length;
const extTotal = (c: Candidate) => c.parties.flatMap((p) => p.slots).filter((s) => s.kind === 'external').length;
const worstCount = (c: Candidate) => c.parties.filter((p) => BAD[p.tier] === worst(c)).length;
const pad = (n: number) => (n + 1e6).toFixed(3).padStart(14, '0');
// 순위 키(설계 수정 C): 편성 캐릭터 수(많을수록) → 외부 총 인원 → 외부 서포터 → 최악 단계 → 최악 단계 공대 수 → imbalance
const rankKey = (c: Candidate) =>
  [-chosenNames(c).length, extTotal(c), extSupports(c), worst(c), worstCount(c), c.imbalance].map(pad).join('|');
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

describe('planRaid: 가는 난이도 (설계 수정 A)', () => {
  const armNormal = getRaid('armoche-normal')!;
  const armHard = getRaid('armoche-hard')!;
  const fs = makeFriends({
    h: [['h1720', 'dealer', 1720, 3200]],
    n: [['n1705', 'dealer', 1705, 2400]],
  });
  const names = (r: PlanResult) => [...new Set(r.candidates.flatMap((c) => [...chosenNames(c), ...unplacedNames(c)]))].sort();

  it('[사용자 사례] 1720 캐릭터는 4막 노말에 추천되지 않고 4막 하드에만 나온다', () => {
    const normal = planRaid({ raid: armNormal, friends: fs, clears: [], attendeeIds: ['h', 'n'] });
    expect(names(normal)).toEqual(['n1705']);
    expect(normal.excluded).toEqual([{ friendId: 'h', reason: '가능한 캐릭터 없음' }]);
    const hard = planRaid({ raid: armHard, friends: fs, clears: [], attendeeIds: ['h', 'n'] });
    expect(names(hard)).toEqual(['h1720']);
    expect(hard.excluded).toEqual([{ friendId: 'n', reason: '가능한 캐릭터 없음' }]);
  });

  it('직접 정한 값: 1720에 노말을 정하면 노말에만, 안 감이면 어디에도, 레벨보다 높은 하드는 자격 없음', () => {
    const look = (m: Record<string, string>) => (_f: string, name: string) => m[name];
    const toNormal = look({ h1720: '노말' });
    expect(names(planRaid({ raid: armNormal, friends: fs, clears: [], attendeeIds: ['h', 'n'], targetDifficulty: toNormal }))).toEqual(['h1720', 'n1705']);
    expect(names(planRaid({ raid: armHard, friends: fs, clears: [], attendeeIds: ['h', 'n'], targetDifficulty: toNormal }))).toEqual([]);
    const skip = look({ h1720: SKIP_DIFFICULTY, n1705: SKIP_DIFFICULTY });
    for (const raid of [armNormal, armHard]) {
      const r = planRaid({ raid, friends: fs, clears: [], attendeeIds: ['h', 'n'], targetDifficulty: skip });
      expect(r.candidates).toEqual([]);
      expect(r.reason).toBe('참석할 수 있는 캐릭터가 없어요');
    }
    const tooHigh = look({ n1705: '하드' });
    expect(names(planRaid({ raid: armHard, friends: fs, clears: [], attendeeIds: ['n'], targetDifficulty: tooHigh }))).toEqual([]);
    expect(names(planRaid({ raid: armNormal, friends: fs, clears: [], attendeeIds: ['n'], targetDifficulty: tooHigh }))).toEqual([]);
  });

  it('조회 함수는 친구 id와 캐릭터 이름으로 부른다', () => {
    const seen: string[] = [];
    planRaid({ raid: armNormal, friends: fs, clears: [], attendeeIds: ['h', 'n'], targetDifficulty: (f, n) => { seen.push(`${f}/${n}`); return undefined; } });
    expect([...new Set(seen)].sort()).toEqual(['h/h1720', 'n/n1705']);
  });
});

describe('planRaid: 공대 규칙 (편성 수 · 친구 최소 인원)', () => {
  it('[헤드라인, 바뀜] 영준(1개) + 현준(2개), 4인: 친구 2명이라 기준이 2로 내려가고 공대 1개(영준+현준), 현준의 다른 캐릭터는 못 간 캐릭터', () => {
    const fs = makeFriends({
      yj: [['영준A', 'dealer', 1735, 3800]],
      hj: [['현준X', 'dealer', 1736, 3700], ['현준Y', 'dealer', 1735, 3000]],
    });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['yj', 'hj'] });
    expect(r.reason).toBeUndefined();
    expect(r.excluded).toEqual([]);
    // 추천 2개 + 맨 끝에 "모두 편성" 대안 1개 (대안은 아래 '모두 편성' 테스트에서 따로 본다)
    const recommended = r.candidates.filter((c) => c.kind === 'recommended');
    expect(recommended.length).toBe(2); // 현준X 또는 현준Y
    expect(r.candidates.map((c) => c.kind)).toEqual(['recommended', 'recommended', 'fullPlacement']);
    for (const c of recommended) {
      expect(c.parties).toHaveLength(1);
      expect(friendSlots(c.parties[0]).map((s) => s.friendId).sort()).toEqual(['hj', 'yj']);
      expect(c.unplaced).toHaveLength(1);
      expect(c.unplaced[0].friendId).toBe('hj');
      expect(c.summary).toEqual({
        friendCount: 2, characterCount: 2, partyCount: 1, externalCount: 2, externalSupports: 1, externalDealers: 1, friendThreshold: 2,
      });
    }
    // 현준X(평균 3,750 여유)가 들어간 편성이 현준Y(평균 3,400 빠듯함)보다 앞선다
    expect(chosenNames(r.candidates[0]).sort()).toEqual(['영준A', '현준X']);
  });

  it('후보 캐릭터는 추천마다 편성 또는 못 간 캐릭터 중 정확히 한 곳에 한 번씩 나온다', () => {
    for (const [raid, expected] of [[serkaHard, ELIGIBLE], [kazerosHard, [...ELIGIBLE, 'e-cleared'].sort()]] as const) {
      const r = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000 });
      expect(r.candidates.length).toBeGreaterThan(1);
      for (const c of r.candidates) {
        expect([...chosenNames(c), ...unplacedNames(c)].sort()).toEqual([...expected].sort());
        // 이 픽스처는 모두 편성할 수 있다
        expect(c.unplaced).toEqual([]);
      }
    }
  });

  it('한 추천 안에서 같은 캐릭터는 두 번 나오지 않는다', () => {
    for (const raid of [serkaHard, kazerosHard]) {
      for (const c of planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000 }).candidates) {
        const names = [...chosenNames(c), ...unplacedNames(c)];
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

  it('입장 레벨 미달/클리어한 캐릭터는 어떤 추천에도(못 간 캐릭터에도) 없다', () => {
    const both: ClearRecord[] = [...clears, { characterName: 'e-cleared', raidName: kazerosHard.name, difficulty: '노말' }];
    for (const raid of [serkaHard, kazerosHard]) {
      const all = planRaid({ raid, friends, clears: both, attendeeIds: ALL, limit: 1000 }).candidates
        .flatMap((c) => [...chosenNames(c), ...unplacedNames(c)]);
      expect(all).not.toContain('a-low');
      expect(all).not.toContain('e-cleared');
    }
  });

  it('공대 수: 4인 9캐릭터(딜러 7) → 3개(기준 3), 8인 10캐릭터 → 2개(친구 5명이라 기준 6이 안 돼 4)', () => {
    const r4 = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    expect(r4.candidates.every((c) => c.parties.length === 3 && c.summary.friendThreshold === 3)).toBe(true);
    const r8 = planRaid({ raid: kazerosHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    expect(r8.candidates.every((c) => c.parties.length === 2 && c.summary.friendThreshold === 4)).toBe(true);
  });

  it('모든 공대 크기는 raid.size, 공대마다 친구 캐릭터는 기준(t) 이상', () => {
    for (const [raid, size] of [[serkaHard, 4], [kazerosHard, 8]] as const) {
      const r = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000 });
      for (const c of r.candidates) {
        for (const p of c.parties) {
          expect(p.slots).toHaveLength(size);
          expect(friendSlots(p).length).toBeGreaterThanOrEqual(c.summary.friendThreshold);
        }
      }
    }
  });

  it('서포터는 서포터 자리 수만큼만 (4인: 공대당 1, 친구 딜러 ≤3)', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    for (const p of r.candidates.flatMap((c) => c.parties)) {
      expect(p.slots.filter((s) => roleOf(s) === 'support').length).toBe(1);
      expect(friendSlots(p).filter((s) => s.character.role === 'dealer').length).toBeLessThanOrEqual(3);
    }
    // b, c만 참석: 서포터 둘(b-sup, c-sup) + 딜러 둘 → 기준 2, 공대 2개, 공대마다 친구 서포터 1명, 두 사람 모두 두 공대에
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
      expect(c.summary.friendThreshold).toBe(2);
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

  it('[바뀜] 서포터가 없으면 외부 서포터로 채운다: d(딜러 2) + e(딜러 1) → 공대 1개, d의 나머지 캐릭터는 못 간 캐릭터', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ['d', 'e'] });
    expect(r.candidates.length).toBeGreaterThan(0);
    // 마지막 "모두 편성" 대안(기준 1, 공대 2개)은 빼고 본다
    expect(r.candidates.at(-1)!.kind).toBe('fullPlacement');
    for (const c of r.candidates.filter((x) => x.kind === 'recommended')) {
      expect(c.parties).toHaveLength(1);
      expect(c.parties[0].slots).toContainEqual({ kind: 'external', role: 'support' });
      expect(c.unplaced.map((u) => u.friendId)).toEqual(['d']);
      expect(c.summary).toEqual({
        friendCount: 2, characterCount: 2, partyCount: 1, externalCount: 2, externalSupports: 1, externalDealers: 1, friendThreshold: 2,
      });
    }
  });

  it('요약 숫자가 맞다 (4인 / 8인)', () => {
    const s4 = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL }).candidates[0].summary;
    expect(s4).toEqual({ friendCount: 5, characterCount: 9, partyCount: 3, externalCount: 3, externalSupports: 1, externalDealers: 2, friendThreshold: 3 });
    const s8 = planRaid({ raid: kazerosHard, friends, clears, attendeeIds: ALL }).candidates[0].summary;
    // 카제로스: e-cleared(세르카만 클리어)도 들어가 캐릭터 10개
    expect(s8).toEqual({ friendCount: 5, characterCount: 10, partyCount: 2, externalCount: 6, externalSupports: 2, externalDealers: 4, friendThreshold: 4 });
    for (const c of planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 }).candidates) {
      expect(c.summary.externalCount).toBe(extTotal(c));
      expect(c.summary.externalSupports).toBe(extSupports(c));
      expect(c.summary.externalSupports + c.summary.externalDealers).toBe(c.summary.externalCount);
      expect(c.summary.partyCount).toBe(c.parties.length);
      expect(c.summary.characterCount).toBe(chosenNames(c).length);
    }
  });

  it('[바뀜] 균형: 딜러 6명(친구 6명), 4인 → 공대 2개, 강한 딜러 둘을 한 공대에 묶지 않는다', () => {
    const fs = makeFriends({
      s1: [['s1', 'dealer', 1735, 4500]], s2: [['s2', 'dealer', 1735, 4400]],
      w1: [['w1', 'dealer', 1735, 3000]], w2: [['w2', 'dealer', 1735, 2900]],
      m1: [['m1', 'dealer', 1735, 3700]], m2: [['m2', 'dealer', 1735, 3600]],
    });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
    const top = r.candidates[0];
    expect(top.parties).toHaveLength(2);
    expect(top.unplaced).toEqual([]);
    const naive = (4500 + 4400 + 3700) / 3 - (3600 + 3000 + 2900) / 3;
    expect(top.imbalance).toBeLessThan(naive);
    expect(top.parties.some((p) => ['s1', 's2'].every((n) => friendSlots(p).some((s) => s.character.name === n)))).toBe(false);
    for (const p of top.parties) expect(p.tier).toBe('comfortable');
  });

  it('클리어로 가능한 캐릭터가 없는 친구는 excluded에 사유와 함께 들어간다', () => {
    const allCleared: ClearRecord[] = [...clears, { characterName: 'e-deal', raidName: '세르카', difficulty: '노말' }];
    const r = planRaid({ raid: serkaHard, friends, clears: allCleared, attendeeIds: ALL });
    expect(r.excluded).toEqual([{ friendId: 'e', reason: '가능한 캐릭터 없음' }]);
    expect(r.candidates.flatMap((c) => c.parties.flatMap(friendSlots)).some((s) => s.friendId === 'e')).toBe(false);
    expect(r.candidates.flatMap((c) => c.unplaced).some((u) => u.friendId === 'e')).toBe(false);
    // 남은 a,b,c,d의 캐릭터 8개(딜러 6, 서포터 2) → 공대 2개
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.parties.length === 2 && c.summary.friendCount === 4)).toBe(true);
  });

  it('서포터만 있는 공대는 dealerAvgCP null, tier unknown, 예외 없음 (친구 1명 → 기준 1)', () => {
    const sOnly = makeFriends({ s: [['s-sup', 'support', 1735, 2600]] });
    const r = planRaid({ raid: serkaHard, friends: sOnly, clears: [], attendeeIds: ['s'] });
    expect(r.candidates).toHaveLength(1);
    const p = r.candidates[0].parties[0];
    expect(p.dealerAvgCP).toBeNull();
    expect(p.tier).toBe('unknown');
    expect(r.candidates[0].summary.externalCount).toBe(3);
    expect(r.candidates[0].summary.friendThreshold).toBe(1);
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
    const onlyNull = planRaid({ raid: serkaHard, friends: makeFriends({ n: [['n-deal', 'dealer', 1735, null]] }), clears: [], attendeeIds: ['n'] });
    expect(onlyNull.candidates[0].parties[0].dealerAvgCP).toBeNull();
    expect(onlyNull.candidates[0].parties[0].tier).toBe('unknown');
  });

  it('참석자 0명이면 candidates [] 이고 예외 없음, reason 없음', () => {
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: [] })).toEqual({ candidates: [], excluded: [] });
  });

  it('정렬: 편성 수 → 외부 총 인원 → 외부 서포터 → 최악 단계 → 최악 단계 공대 수 → imbalance, imbalance는 공대 평균 최댓값-최솟값', () => {
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

  it('[바뀜] 딜러만 4명(친구 4명)이 4인 레이드: 공대 1개(딜러 3 + 외부 서포터), 1명은 못 간 캐릭터', () => {
    const dealers = makeFriends({
      w: [['w1', 'dealer', 1735, 3600]], x: [['x1', 'dealer', 1735, 3600]],
      y: [['y1', 'dealer', 1735, 3600]], z: [['z1', 'dealer', 1735, 3600]],
    });
    const r = planRaid({ raid: serkaHard, friends: dealers, clears: [], attendeeIds: ['w', 'x', 'y', 'z'] });
    expect(r.reason).toBeUndefined();
    expect(r.candidates.length).toBeGreaterThan(0);
    // 마지막 "모두 편성" 대안(기준 1, 공대 2개)은 빼고 본다
    expect(r.candidates.at(-1)!.kind).toBe('fullPlacement');
    for (const c of r.candidates.filter((x) => x.kind === 'recommended')) {
      expect(c.parties).toHaveLength(1);
      expect(c.parties[0].slots.filter((sl) => sl.kind === 'external')).toEqual([{ kind: 'external', role: 'support' }]);
      expect(c.summary.externalCount).toBe(1);
      expect(c.unplaced).toHaveLength(1);
      expect([...chosenNames(c), ...unplacedNames(c)].sort()).toEqual(['w1', 'x1', 'y1', 'z1']);
    }
  });

  it('서포터만 4명이 4인 레이드: 서포터 자리가 1개라 기준이 1로 내려가 공대 4개 (공대마다 서포터 1 + 외부 딜러 3)', () => {
    const supports = makeFriends({
      w: [['w1', 'support', 1735, 2000]], x: [['x1', 'support', 1735, 2000]],
      y: [['y1', 'support', 1735, 2000]], z: [['z1', 'support', 1735, 2000]],
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
    expect(c.summary).toEqual({ friendCount: 4, characterCount: 4, partyCount: 4, externalCount: 12, externalSupports: 0, externalDealers: 12, friendThreshold: 1 });
  });

  it('친구 한 명이 캐릭터 3개면 공대 3개 (캐릭터마다 다른 공대, 기준 1)', () => {
    const fs = makeFriends({ m: [['m1', 'dealer', 1735, 3600], ['m2', 'dealer', 1735, 3500], ['m3', 'support', 1735, 2000]] });
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
      p: [['same', 'dealer', 1735, 4000], ['p-sup', 'support', 1735, 2500]],
      q: [['same', 'dealer', 1735, 4000]],
      r: [['r1', 'dealer', 1735, 3700]],
    });
    const res = planRaid({ raid: serkaHard, friends: dup, clears: [], attendeeIds: ['p', 'q', 'r'] });
    expect(res.candidates.length).toBeGreaterThan(0);
    for (const c of res.candidates) {
      const names = [...chosenNames(c), ...unplacedNames(c)];
      expect(new Set(names).size).toBe(names.length);
      expect(c.parties.flatMap((p) => p.slots).some((s) => s.kind === 'friend' && s.friendId === 'q')).toBe(false);
      expect(c.unplaced.some((u) => u.friendId === 'q')).toBe(false);
    }
    expect(res.excluded).toEqual([{ friendId: 'q', reason: '가능한 캐릭터 없음' }]);
  });

  it('후보가 있으면 reason 없음', () => {
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL }).reason).toBeUndefined();
  });
});

describe('planRaid: 친구로 꽉 찬 공대 우선 (설계 수정 C)', () => {
  /** 예전 규칙(후보 전부 한 번씩, 최소 공대 수)의 공대 수와 외부 인원. */
  const oldRule = (fs: Friend[], raid: RaidConfig) => {
    const all = fs.flatMap((f) => f.characters);
    const ss = raid.size / 4;
    const sup = all.filter((c) => c.role === 'support').length;
    const P = Math.max(1, ...fs.map((f) => f.characters.length), Math.ceil((all.length - sup) / (raid.size - ss)), Math.ceil(sup / ss), Math.ceil(all.length / raid.size));
    return { parties: P, externals: P * raid.size - all.length };
  };

  it('[사용자 사례] 친구 6명 · 후보 15개 · 4인 · 서포터 부족: 예전보다 공대도 외부인도 적고, 못 간 캐릭터를 알려 주고, 공대마다 친구 3명 이상', () => {
    const fs = makeFriends({
      main: [
        ['m-1', 'dealer', 1739, 4300], ['m-2', 'dealer', 1738, 4100], ['m-3', 'support', 1737, 2600],
        ['m-4', 'dealer', 1736, 3900], ['m-5', 'dealer', 1735, 3700], ['m-6', 'dealer', 1731, 3400],
      ],
      f2: [['f2-1', 'dealer', 1738, 4000], ['f2-2', 'support', 1736, 2500], ['f2-3', 'dealer', 1733, 3500]],
      f3: [['f3-1', 'dealer', 1737, 3900], ['f3-2', 'dealer', 1732, 3600]],
      f4: [['f4-1', 'dealer', 1736, 3800], ['f4-2', 'dealer', 1731, 3500]],
      f5: [['f5-1', 'dealer', 1735, 3700]],
      f6: [['f6-1', 'dealer', 1734, 3650]],
    });
    expect(fs.flatMap((f) => f.characters)).toHaveLength(15);
    const old = oldRule(fs, serkaHard);
    expect(old).toEqual({ parties: 6, externals: 9 });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
    const top = r.candidates[0];
    expect(top.summary.partyCount).toBeLessThan(old.parties);
    expect(top.summary.externalCount).toBeLessThan(old.externals);
    expect(top.summary).toMatchObject({ friendThreshold: 3, characterCount: 13, partyCount: 4, externalCount: 3, externalSupports: 2, externalDealers: 1 });
    expect(top.unplaced).toHaveLength(2);
    expect([...chosenNames(top), ...unplacedNames(top)].sort()).toEqual(fs.flatMap((f) => f.characters.map((c) => c.name)).sort());
    for (const c of r.candidates) {
      // 추천은 공대마다 친구 3명 이상, 마지막 "모두 편성" 대안은 낮춘 기준(15개 모두 편성)
      const t = c.kind === 'recommended' ? 3 : c.summary.friendThreshold;
      for (const p of c.parties) expect(friendSlots(p).length).toBeGreaterThanOrEqual(t);
    }
    expect(r.candidates.at(-1)).toMatchObject({ kind: 'fullPlacement', unplaced: [], summary: { characterCount: 15 } });
    // 서포터는 모두 편성된다 (외부 서포터를 줄이는 것이 ③번 목표)
    expect(chosenNames(top)).toEqual(expect.arrayContaining(['m-3', 'f2-2']));
  });

  it('친구가 두 명뿐이면 기준을 낮춰(4인 2, 8인 1) 그래도 추천을 낸다', () => {
    const fs = makeFriends({
      a: [['a1', 'dealer', 1735, 3800], ['a2', 'support', 1735, 2500], ['a3', 'dealer', 1735, 3500]],
      b: [['b1', 'dealer', 1735, 3900], ['b2', 'dealer', 1735, 3300]],
    });
    const r4 = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['a', 'b'] });
    expect(r4.reason).toBeUndefined();
    expect(r4.candidates.length).toBeGreaterThan(0);
    expect(r4.candidates[0].summary).toMatchObject({ friendThreshold: 2, partyCount: 2, characterCount: 4 });
    const r8 = planRaid({ raid: kazerosHard, friends: fs, clears: [], attendeeIds: ['a', 'b'] });
    expect(r8.candidates.length).toBeGreaterThan(0);
    // 8인: 한 공대에 친구는 최대 2명 → 기준 6, 4 모두 안 돼 1. 친구 캐릭터 5개를 공대 3개(a가 3개)에 모두 넣는다
    expect(r8.candidates[0].summary).toMatchObject({ friendThreshold: 1, partyCount: 3, characterCount: 5 });
  });

  it('기준은 공대 하나라도 만들 수 있는 가장 높은 값이고, 한 추천의 모든 공대에 같은 기준을 쓴다', () => {
    // 친구 3명(각 딜러 2개), 4인: 기준 3으로 공대 2개 (6개 모두)
    const fs = makeFriends({
      a: [['a1', 'dealer', 1735, 3800], ['a2', 'dealer', 1735, 3500]],
      b: [['b1', 'dealer', 1735, 3900], ['b2', 'dealer', 1735, 3300]],
      c: [['c1', 'dealer', 1735, 3700], ['c2', 'dealer', 1735, 3400]],
    });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['a', 'b', 'c'], limit: 20 });
    for (const c of r.candidates) {
      expect(c.summary.friendThreshold).toBe(3);
      expect(c.parties).toHaveLength(2);
      for (const p of c.parties) expect(friendSlots(p)).toHaveLength(3);
    }
  });
});

describe('planRaid: "모두 편성" 대안 (기준을 낮춰 더 많이 편성, 설계 수정 C 추가)', () => {
  const recs = (r: PlanResult) => r.candidates.filter((c) => c.kind === 'recommended');
  const alts = (r: PlanResult) => r.candidates.filter((c) => c.kind === 'fullPlacement');
  // 리뷰 사례를 줄인 것: 8인, 친구 7명, 후보 17개 (캐릭터 수 4,4,3,2,2,1,1; 서포터 2).
  // 기준 6: 공대 2개(친구마다 ≤ 2개 → 최대 12개), 기준 4: 공대 4개에 17개 모두.
  const seven = makeFriends({
    a: [['a1', 'dealer', 1735, 4100], ['a2', 'dealer', 1735, 3900], ['a3', 'support', 1735, 2500], ['a4', 'dealer', 1735, 3500]],
    b: [['b1', 'dealer', 1735, 4000], ['b2', 'dealer', 1735, 3800], ['b3', 'dealer', 1735, 3600], ['b4', 'dealer', 1735, 3400]],
    c: [['c1', 'dealer', 1735, 4200], ['c2', 'support', 1735, 2400], ['c3', 'dealer', 1735, 3300]],
    d: [['d1', 'dealer', 1735, 3950], ['d2', 'dealer', 1735, 3700]],
    e: [['e1', 'dealer', 1735, 3850], ['e2', 'dealer', 1735, 3650]],
    f: [['f1', 'dealer', 1735, 4050]],
    g: [['g1', 'dealer', 1735, 3750]],
  });
  const SEVEN = seven.map((f) => f.id);
  const ALL17 = seven.flatMap((f) => f.characters.map((c) => c.name)).sort();

  it('[리뷰 사례] 8인 · 친구 7명 · 후보 17개: 추천(기준 6)은 12개만, 마지막에 "모두 편성"(기준 4) 하나가 17개 모두 편성', () => {
    expect(ALL17).toHaveLength(17);
    const r = planRaid({ raid: kazerosHard, friends: seven, clears: [], attendeeIds: SEVEN });
    expect(r.candidates.length).toBeLessThanOrEqual(3);
    expect(alts(r)).toHaveLength(1);
    const alt = r.candidates[r.candidates.length - 1];
    expect(alt.kind).toBe('fullPlacement');
    expect(recs(r).length).toBeGreaterThan(0);
    expect(recs(r).length).toBeLessThanOrEqual(2);
    const rec1 = r.candidates[0];
    expect(rec1.kind).toBe('recommended');
    for (const c of recs(r)) {
      expect(c.summary).toMatchObject({ friendThreshold: 6, characterCount: 12, partyCount: 2, externalCount: 4 });
      expect(c.unplaced).toHaveLength(5);
      expect(c.summary.extraExternalVsBest).toBeUndefined();
      expect(c.summary.extraPlacedVsBest).toBeUndefined();
    }
    expect(alt.summary).toMatchObject({
      friendThreshold: 4, characterCount: 17, partyCount: 4, externalCount: 15,
      extraExternalVsBest: 15 - 4, extraPlacedVsBest: 17 - 12,
    });
    expect(alt.summary.extraExternalVsBest).toBe(alt.summary.externalCount - rec1.summary.externalCount);
    expect(alt.summary.extraPlacedVsBest).toBe(alt.summary.characterCount - rec1.summary.characterCount);
    expect(alt.unplaced).toEqual([]);
    expect(chosenNames(alt).sort()).toEqual(ALL17);
    for (const p of alt.parties) {
      expect(p.slots).toHaveLength(8);
      const fsl = friendSlots(p);
      expect(fsl.length).toBeGreaterThanOrEqual(4);
      expect(new Set(fsl.map((s) => s.friendId)).size).toBe(fsl.length);
      expect(p.slots.filter((s) => roleOf(s) === 'support')).toHaveLength(2);
    }
    // 같은 입력이면 같은 결과
    expect(planRaid({ raid: kazerosHard, friends: seven, clears: [], attendeeIds: SEVEN })).toEqual(r);
  });

  it('추천이 이미 모두 편성하면 대안은 없다', () => {
    for (const raid of [serkaHard, kazerosHard]) {
      const r = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 5 });
      expect(r.candidates.every((c) => c.unplaced.length === 0)).toBe(true);
      expect(alts(r)).toEqual([]);
      expect(r.candidates).toHaveLength(5);
      expect(r.candidates.every((c) => c.kind === 'recommended')).toBe(true);
    }
  });

  it('[헤드라인] 영준(1개) + 현준(2개), 4인: 추천은 2개 편성, 대안(기준 1)은 공대 2개로 3개 모두', () => {
    const fs = makeFriends({
      yj: [['영준A', 'dealer', 1735, 3800]],
      hj: [['현준X', 'dealer', 1736, 3700], ['현준Y', 'dealer', 1735, 3000]],
    });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['yj', 'hj'] });
    expect(r.candidates.map((c) => c.kind)).toEqual(['recommended', 'recommended', 'fullPlacement']);
    const alt = r.candidates[2];
    expect(alt.summary).toMatchObject({
      friendThreshold: 1, characterCount: 3, partyCount: 2, externalCount: 5, extraExternalVsBest: 3, extraPlacedVsBest: 1,
    });
    expect(alt.unplaced).toEqual([]);
  });

  it('limit 1/2/3/5: 대안도 limit 안에 세고 항상 마지막, 나머지는 추천으로 채운다 (limit 1이면 대안 없음)', () => {
    const all = planRaid({ raid: kazerosHard, friends: seven, clears: [], attendeeIds: SEVEN, limit: 1000 });
    const available = recs(all).length;
    expect(available).toBeGreaterThanOrEqual(4);
    const alt0 = alts(all)[0];
    let first: Candidate | undefined;
    for (const limit of [1, 2, 3, 5]) {
      const r = planRaid({ raid: kazerosHard, friends: seven, clears: [], attendeeIds: SEVEN, limit });
      expect(r.candidates).toHaveLength(limit);
      first ??= r.candidates[0];
      expect(r.candidates[0]).toEqual(first);
      if (limit === 1) {
        expect(r.candidates[0].kind).toBe('recommended');
        continue;
      }
      expect(r.candidates.map((c) => c.kind)).toEqual([...Array(limit - 1).fill('recommended'), 'fullPlacement']);
      expect(r.candidates[limit - 1]).toEqual(alt0);
    }
  });

  it('대안은 어떤 추천과도 같은 편성이 아니고, 추천보다 편성 수가 많다 (무작위 입력, 고정 시드)', () => {
    const rand = rngFor(4242);
    let withAlt = 0;
    for (let n = 0; n < 150; n++) {
      const raid = rand() < 0.5 ? serkaHard : kazerosHard;
      const spec: Record<string, C[]> = {};
      const fCount = 2 + Math.floor(rand() * 7);
      for (let f = 0; f < fCount; f++) {
        spec[`x${f}`] = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, j): C =>
          [`x${f}-${j}`, rand() < 0.25 ? 'support' : 'dealer', 1735, 3000 + Math.round(rand() * 15) * 100]);
      }
      const fs = makeFriends(spec);
      const r = planRaid({ raid, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id), limit: 1 + Math.floor(rand() * 5) });
      const a = alts(r);
      expect(a.length).toBeLessThanOrEqual(1);
      if (!a.length) continue;
      withAlt++;
      const recKeys = recs(r).map(groupingKey);
      expect(recKeys).not.toContain(groupingKey(a[0]));
      expect(a[0].summary.characterCount).toBeGreaterThan(r.candidates[0].summary.characterCount);
    }
    expect(withAlt).toBeGreaterThan(20);
  });
});

// ---------- 무차별 대입 비교 / 무작위 규칙 검사 ----------

function rngFor(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Best { t: number; placed: number; parties: number; extSupports: number; worst: number }

/**
 * 아주 작은 입력(캐릭터 ≤ 8, 모두 후보)에서 가능한 모든 배정(캐릭터마다 못 감 또는 공대 하나)을 펼쳐
 * 기준 t(공대 하나라도 되는 가장 높은 값)와 ①②③(그다음 ④ 최악 단계)의 최적값을 구한다.
 */
function bruteForce(fs: Friend[], raid: RaidConfig): Best | null {
  const best = bruteForceLevels(fs, raid);
  for (const t of best.keys()) return best.get(t)!; // 가장 높은 기준부터 들어 있다
  return null;
}

/** 기준 t마다 (공대 하나라도 되는 t만) ①②③④ 최적값. 키 순서는 높은 기준부터. */
function bruteForceLevels(fs: Friend[], raid: RaidConfig): Map<number, Best> {
  const items = fs.flatMap((f) => f.characters.map((c) => ({ f: f.id, sup: c.role === 'support', cp: c.combatPower })));
  const ss = raid.size / 4;
  const ds = raid.size - ss;
  const levels = [...new Set([Math.ceil(raid.size * 0.75), Math.ceil(raid.size * 0.5), 1])];
  const best = new Map<number, Best>();
  const groups: number[][] = [];
  const better = (a: Best, b: Best) =>
    b.placed - a.placed || a.parties - b.parties || a.extSupports - b.extSupports || a.worst - b.worst;
  const evaluate = () => {
    if (groups.length === 0) return;
    const minSize = Math.min(...groups.map((g) => g.length));
    const placed = groups.reduce((s, g) => s + g.length, 0);
    const extSup = groups.reduce((s, g) => s + ss - g.filter((i) => items[i].sup).length, 0);
    const w = Math.max(...groups.map((g) => {
      const cps = g.flatMap((i) => (!items[i].sup && items[i].cp !== null ? [items[i].cp!] : []));
      return BAD[tierFor(cps.length ? cps.reduce((a, b) => a + b, 0) / cps.length : null, raid)];
    }));
    for (const t of levels) {
      if (minSize < t) continue;
      const cand: Best = { t, placed, parties: groups.length, extSupports: extSup, worst: w };
      const cur = best.get(t);
      if (!cur || better(cand, cur) < 0) best.set(t, cand);
    }
  };
  const walk = (k: number) => {
    if (k === items.length) { evaluate(); return; }
    walk(k + 1); // 못 감
    const it = items[k];
    for (const g of groups) {
      if (g.some((i) => items[i].f === it.f)) continue;
      if (g.filter((i) => items[i].sup === it.sup).length >= (it.sup ? ss : ds)) continue;
      g.push(k);
      walk(k + 1);
      g.pop();
    }
    groups.push([k]);
    walk(k + 1);
    groups.pop();
  };
  walk(0);
  return new Map(levels.filter((t) => best.has(t)).map((t) => [t, best.get(t)!]));
}

describe('planRaid: 작은 입력은 무차별 대입 최적과 같다 (①②③)', () => {
  it('캐릭터 ≤ 8, 4인/8인, 고정 시드 300개: 기준 t와 ① 편성 수 ② 외부 인원(공대 수) ③ 외부 서포터가 최적과 같고, ④ 최악 단계도 거의 항상 같다', () => {
    const rand = rngFor(20261016);
    let checked = 0;
    let worstOptimal = 0;
    for (let n = 0; n < 300; n++) {
      const raid = rand() < 0.5 ? serkaHard : kazerosHard;
      const friendCount = 1 + Math.floor(rand() * 5);
      const spec: Record<string, C[]> = {};
      let total = 0;
      for (let f = 0; f < friendCount && total < 8; f++) {
        const k = Math.min(1 + Math.floor(rand() * 3), 8 - total);
        total += k;
        spec[`r${f}`] = Array.from({ length: k }, (_, j): C => {
          const support = rand() < 0.3;
          const cp = rand() < 0.1 ? null : 2800 + Math.round(rand() * 18) * 100;
          return [`r${f}-${j}`, support ? 'support' : 'dealer', 1735, cp];
        });
      }
      const fs = makeFriends(spec);
      const best = bruteForce(fs, raid);
      const r = planRaid({ raid, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
      if (!best) { expect(r.candidates).toEqual([]); continue; }
      checked++;
      const top = r.candidates[0];
      expect({ case: n, t: top.summary.friendThreshold, placed: top.summary.characterCount, parties: top.summary.partyCount, extSupports: top.summary.externalSupports })
        .toEqual({ case: n, t: best.t, placed: best.placed, parties: best.parties, extSupports: best.extSupports });
      if (worst(top) === best.worst) worstOptimal++;
    }
    expect(checked).toBe(300);
    expect(worstOptimal / checked).toBeGreaterThan(0.97);
  });

  it('"모두 편성" 대안: 캐릭터 ≤ 8, 4인/8인, 고정 시드 300개: 어느 기준으로든 가능한 최대 편성 수를 편성하고, 그 수가 1순위보다 많을 때만 나온다', () => {
    const rand = rngFor(1016);
    let present = 0;
    let absent = 0;
    for (let n = 0; n < 300; n++) {
      const raid = rand() < 0.5 ? serkaHard : kazerosHard;
      const friendCount = 1 + Math.floor(rand() * 5);
      const spec: Record<string, C[]> = {};
      let total = 0;
      for (let f = 0; f < friendCount && total < 8; f++) {
        const k = Math.min(1 + Math.floor(rand() * 4), 8 - total);
        total += k;
        spec[`r${f}`] = Array.from({ length: k }, (_, j): C => {
          const support = rand() < 0.3;
          const cp = rand() < 0.1 ? null : 2800 + Math.round(rand() * 18) * 100;
          return [`r${f}-${j}`, support ? 'support' : 'dealer', 1735, cp];
        });
      }
      const fs = makeFriends(spec);
      const levels = bruteForceLevels(fs, raid);
      const maxPlaced = Math.max(...[...levels.values()].map((b) => b.placed));
      const r = planRaid({ raid, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
      const rec1 = r.candidates[0];
      const alt = r.candidates.filter((c) => c.kind === 'fullPlacement');
      if (maxPlaced <= rec1.summary.characterCount) {
        absent++;
        expect({ case: n, alt: alt.length }).toEqual({ case: n, alt: 0 });
        continue;
      }
      present++;
      expect({ case: n, alt: alt.length, last: r.candidates[r.candidates.length - 1].kind }).toEqual({ case: n, alt: 1, last: 'fullPlacement' });
      // 그 편성 수를 이루는 가장 높은 기준, 그 기준에서의 ②③ 최적
      const level = [...levels.keys()].find((t) => levels.get(t)!.placed === maxPlaced)!;
      const b = levels.get(level)!;
      const s = alt[0].summary;
      expect({ case: n, t: s.friendThreshold, placed: s.characterCount, parties: s.partyCount, extSupports: s.externalSupports })
        .toEqual({ case: n, t: level, placed: maxPlaced, parties: b.parties, extSupports: b.extSupports });
      expect(s.extraPlacedVsBest).toBe(maxPlaced - rec1.summary.characterCount);
      expect(s.extraExternalVsBest).toBe(s.externalCount - rec1.summary.externalCount);
    }
    expect(present).toBeGreaterThan(30);
    expect(absent).toBeGreaterThan(30);
  });
});

describe('planRaid: 무작위 입력의 규칙 검사 (가는 난이도 · 클리어 · 숙련도 무작위, 고정 시드)', () => {
  it('400개: 규칙(후보 자격, 한 번씩, 같은 친구 없음, 역할 자리, 크기, 기준 t, 요약, 결정성)을 항상 지킨다', () => {
    const rand = rngFor(777);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const raidNames = [...new Set(RAIDS.map((r) => r.name))];
    const levels: Proficiency[] = ['숙련', '반숙', '클경'];
    let nonEmpty = 0;
    let relaxed = 0;
    let withUnplaced = 0;
    let withAlt = 0;
    for (let n = 0; n < 400; n++) {
      const raid = pick(RAIDS);
      const fCount = 1 + Math.floor(rand() * 8);
      const spec: Record<string, C[]> = {};
      for (let f = 0; f < fCount; f++) {
        const k = 1 + Math.floor(rand() * 6);
        spec[`f${f}`] = Array.from({ length: k }, (_, j): C => [
          `f${f}-${j}`, rand() < 0.3 ? 'support' : 'dealer', 1690 + Math.floor(rand() * 95), rand() < 0.1 ? null : 1500 + Math.round(rand() * 50) * 100,
        ]);
      }
      const fs = makeFriends(spec);
      const overrides: Record<string, string> = {};
      const profs: Record<string, Proficiency> = {};
      const cl: ClearRecord[] = [];
      for (const c of fs.flatMap((f) => f.characters)) {
        if (rand() < 0.25) overrides[c.name] = pick([...difficultiesOf(raid.name), SKIP_DIFFICULTY]);
        if (rand() < 0.4) profs[c.name] = pick(levels);
        if (rand() < 0.2) {
          const rn = pick(raidNames);
          cl.push({ characterName: c.name, raidName: rn, difficulty: pick(difficultiesOf(rn)) });
        }
      }
      const attendeeIds = fs.map((f) => f.id).filter(() => rand() < 0.85);
      const limit = 1 + Math.floor(rand() * 4);
      const input = {
        raid, friends: fs, clears: cl, attendeeIds, limit,
        targetDifficulty: (_f: string, name: string) => overrides[name],
        proficiency: (_f: string, name: string) => profs[name],
      };
      const r = planRaid(input);
      expect(planRaid(input)).toEqual(r);

      // 후보(자격) 직접 계산
      const pool = new Map<string, string>(); // name -> friendId
      const excludedIds: string[] = [];
      for (const f of fs) {
        if (!attendeeIds.includes(f.id)) continue;
        const mine = f.characters.filter((c) => c.itemLevel >= raid.minLevel
          && !cl.some((x) => x.characterName === c.name && x.raidName === raid.name)
          && effectiveDifficulty(c.itemLevel, raid.name, overrides[c.name]) === raid.difficulty);
        if (mine.length === 0) excludedIds.push(f.id);
        for (const c of mine) pool.set(c.name, f.id);
      }
      expect(r.excluded.map((e) => e.friendId)).toEqual(excludedIds);
      expect(r.excluded.every((e) => e.reason === '가능한 캐릭터 없음')).toBe(true);
      if (pool.size === 0) {
        expect(r.candidates).toEqual([]);
        if (attendeeIds.length === 0) expect(r.reason).toBeUndefined();
        continue;
      }
      nonEmpty++;
      expect(r.reason).toBeUndefined();
      expect(r.candidates.length).toBeGreaterThan(0);
      expect(r.candidates.length).toBeLessThanOrEqual(limit);
      expect(new Set(r.candidates.map(groupingKey)).size).toBe(r.candidates.length);
      const ss = raid.size / 4;
      const t0 = r.candidates[0].summary.friendThreshold;
      if (t0 < Math.ceil(raid.size * 0.75)) relaxed++;
      // "모두 편성" 대안: 최대 1개, 항상 마지막, limit 1이면 없음, 1순위보다 더 많이 편성, 기준은 1순위 이하
      const kinds = r.candidates.map((c) => c.kind);
      const altIdx = kinds.indexOf('fullPlacement');
      expect(kinds.filter((k) => k === 'fullPlacement').length).toBeLessThanOrEqual(1);
      expect(kinds.every((k) => k === 'recommended' || k === 'fullPlacement')).toBe(true);
      expect(kinds[0]).toBe('recommended');
      if (altIdx >= 0) {
        withAlt++;
        expect(altIdx).toBe(r.candidates.length - 1);
        expect(limit).toBeGreaterThanOrEqual(2);
        const alt = r.candidates[altIdx];
        expect(alt.summary.characterCount).toBeGreaterThan(r.candidates[0].summary.characterCount);
        expect(alt.summary.friendThreshold).toBeLessThanOrEqual(t0);
        expect(r.candidates.slice(0, altIdx).map(groupingKey)).not.toContain(groupingKey(alt));
      }
      for (const c of r.candidates) {
        const placed = chosenNames(c);
        const isAlt = c.kind === 'fullPlacement';
        const tc = c.summary.friendThreshold;
        if (c.unplaced.length) withUnplaced++;
        expect([...placed, ...unplacedNames(c)].sort()).toEqual([...pool.keys()].sort());
        for (const u of c.unplaced) expect(u.friendId).toBe(pool.get(u.characterName));
        if (!isAlt) expect(tc).toBe(t0);
        for (const p of c.parties) {
          const fsl = friendSlots(p);
          expect(p.slots).toHaveLength(raid.size);
          expect(new Set(fsl.map((s) => s.friendId)).size).toBe(fsl.length);
          for (const s of fsl) expect(s.friendId).toBe(pool.get(s.character.name));
          expect(fsl.filter((s) => s.character.role === 'support').length).toBeLessThanOrEqual(ss);
          expect(fsl.filter((s) => s.character.role === 'dealer').length).toBeLessThanOrEqual(raid.size - ss);
          expect(p.slots.filter((s) => roleOf(s) === 'support')).toHaveLength(ss);
          expect(fsl.length).toBeGreaterThanOrEqual(tc);
          for (const s of fsl) expect(s.proficiency).toBe(profs[s.character.name] ?? '반숙');
          const cps = fsl.flatMap((s) => (s.character.role === 'dealer' && s.character.combatPower !== null ? [s.character.combatPower] : []));
          expect(p.dealerAvgCP).toBe(cps.length ? cps.reduce((a, b) => a + b, 0) / cps.length : null);
          expect(p.tier).toBe(tierFor(p.dealerAvgCP, raid));
        }
        expect(c.summary).toEqual({
          friendCount: new Set(c.parties.flatMap((p) => friendSlots(p).map((s) => s.friendId))).size,
          characterCount: placed.length, partyCount: c.parties.length,
          externalCount: extTotal(c), externalSupports: extSupports(c), externalDealers: extTotal(c) - extSupports(c),
          friendThreshold: tc,
          ...(isAlt ? {
            extraExternalVsBest: extTotal(c) - r.candidates[0].summary.externalCount,
            extraPlacedVsBest: placed.length - r.candidates[0].summary.characterCount,
          } : {}),
        });
        if (isAlt) continue;
        // ①②③은 1순위가 가장 좋다 (추천끼리)
        const top = r.candidates[0];
        const k = (x: Candidate) => [-x.summary.characterCount, x.summary.externalCount, x.summary.externalSupports];
        const [a, b] = [k(top), k(c)];
        expect(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])))).toBe(true);
      }
      // 기준이 낮아졌다면 더 높은 기준으로는 공대 하나도 만들 수 없었다
      const attendFriends = fs.filter((f) => attendeeIds.includes(f.id));
      const maxSingle = (() => {
        let onlyS = 0; let onlyD = 0; let both = 0;
        for (const f of attendFriends) {
          const mine = f.characters.filter((c) => pool.get(c.name) === f.id);
          const s = mine.some((c) => c.role === 'support');
          const d = mine.some((c) => c.role === 'dealer');
          if (s && d) both++; else if (s) onlyS++; else if (d) onlyD++;
        }
        const x = Math.min(ss, onlyS);
        const y = Math.min(raid.size - ss, onlyD);
        return x + y + Math.min(both, ss - x + raid.size - ss - y);
      })();
      expect(maxSingle).toBeGreaterThanOrEqual(t0);
      for (const higher of [Math.ceil(raid.size * 0.75), Math.ceil(raid.size * 0.5)]) {
        if (higher > t0) expect(maxSingle).toBeLessThan(higher);
      }
    }
    expect(nonEmpty).toBeGreaterThan(150);
    expect(relaxed).toBeGreaterThan(10);
    expect(withUnplaced).toBeGreaterThan(10);
    expect(withAlt).toBeGreaterThan(10);
  });
});

describe('planRaid: 편성 품질 (서포터가 섞인 교환, 최악 단계 공대 수)', () => {
  it('[회귀] 같은 친구의 딜러와 서포터를 공대끼리 바꿔야 위험 공대가 없어지는 경우도 찾는다 (8인)', () => {
    const fs = makeFriends({
      A: [['A-sup1', 'support', 1735, 2000], ['A-weak', 'dealer', 1735, 3350], ['A-sup2', 'support', 1735, 2000]],
      B: [['B-strong', 'dealer', 1735, 4600], ['B-weak', 'dealer', 1735, 3350], ['B-sup', 'support', 1735, 2000]],
      C: [['C-strong', 'dealer', 1735, 4300]],
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
      a: [['a', 'dealer', 1735, 4400]], b: [['b', 'dealer', 1735, 3300]], c: [['c', 'dealer', 1735, 3200]],
      d: [['d', 'dealer', 1735, 3000]], e: [['e', 'dealer', 1735, 2000]], f: [['f', 'dealer', 1735, 2000]],
    });
    const r = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['a', 'b', 'c', 'd', 'e', 'f'], limit: 50 });
    const top = r.candidates[0];
    expect(top.parties.filter((p) => p.tier === 'risky')).toHaveLength(1);
    // 둘 다 위험인(더 고른) 편성도 후보에는 있지만 뒤에 온다
    const bothRisky = r.candidates.findIndex((c) => c.parties.every((p) => p.tier === 'risky'));
    expect(bothRisky).toBeGreaterThan(0);
    expect(r.candidates[bothRisky].imbalance).toBeLessThan(top.imbalance);
  });

  it('못 간 캐릭터를 고를 때도 단계를 본다: 약한 딜러를 빼서 여유 공대를 만든다', () => {
    // 친구 4명(딜러 1개씩), 4인 → 공대 1개에 3명. 약한 w를 빼면 여유.
    const fs = makeFriends({
      a: [['a1', 'dealer', 1735, 3800]], b: [['b1', 'dealer', 1735, 3700]],
      c: [['c1', 'dealer', 1735, 3600]], w: [['w1', 'dealer', 1735, 2000]],
    });
    const top = planRaid({ raid: serkaHard, friends: fs, clears: [], attendeeIds: ['a', 'b', 'c', 'w'] }).candidates[0];
    expect(top.unplaced).toEqual([{ friendId: 'w', characterName: 'w1' }]);
    expect(top.parties[0].tier).toBe('comfortable');
  });
});

describe('planRaid: 성능', () => {
  const bigFriends = (n: number): Friend[] => {
    const roles: ('dealer' | 'support')[] = ['dealer', 'dealer', 'support', 'dealer', 'support', 'dealer'];
    return makeFriends(
      Object.fromEntries(
        Array.from({ length: n }, (_, f) => [
          `p${f}`,
          roles.map((role, k): C => [`p${f}-${k}`, role, 1730 + k, 3000 + f * 97 + k * 131]),
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
    console.log(`[성능] 8x6: 8인 ${k.ms.toFixed(0)}ms, 4인 ${s.ms.toFixed(0)}ms`);
  });

  it('16명 x 6캐릭터: 8인 레이드 공대 16개, 4인 레이드 공대 32개, 각각 3초 안', () => {
    const k = timed(kazerosHard, 16);
    checkAll(k.r, 16, 16);
    expect(k.ms).toBeLessThan(3000);
    const s = timed(serkaHard, 16);
    checkAll(s.r, 16, 32);
    expect(s.ms).toBeLessThan(3000);
    console.log(`[성능] 16x6: 8인 ${k.ms.toFixed(0)}ms, 4인 ${s.ms.toFixed(0)}ms`);
  });

  it('못 간 캐릭터가 생길 수 있는 입력(친구 16명, 한 명이 캐릭터 6개·나머지 1~2개)도 3초 안', () => {
    const spec: Record<string, C[]> = { big: Array.from({ length: 6 }, (_, k): C => [`big-${k}`, k === 2 ? 'support' : 'dealer', 1735, 3000 + k * 211]) };
    for (let f = 0; f < 15; f++) {
      spec[`s${f}`] = Array.from({ length: 1 + (f % 2) }, (_, k): C => [`s${f}-${k}`, (f + k) % 5 === 0 ? 'support' : 'dealer', 1735, 2800 + ((f * 37 + k * 53) % 20) * 90]);
    }
    const fs = makeFriends(spec);
    for (const raid of [serkaHard, kazerosHard]) {
      const t0 = performance.now();
      const r = planRaid({ raid, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(3000);
      expect(r.candidates.length).toBeGreaterThan(0);
      console.log(`[성능] 못 간 캐릭터가 생기는 16명 (${raid.size}인): ${ms.toFixed(0)}ms, 못 간 ${r.candidates[0].unplaced.length}개`);
    }
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

  it('"모두 편성" 대안을 같이 찾는 입력도 8명은 1초, 16명은 3초 안 (캐릭터 많은 친구 + 캐릭터 1개 친구)', () => {
    const lopsided = (many: number, few: number): Friend[] => makeFriends(Object.fromEntries([
      ...Array.from({ length: many }, (_, f) => [`m${f}`, Array.from({ length: 6 }, (_, k): C =>
        [`m${f}-${k}`, k % 3 === 2 ? 'support' : 'dealer', 1735, 2900 + ((f * 41 + k * 59) % 16) * 90])]),
      ...Array.from({ length: few }, (_, f) => [`o${f}`, [[`o${f}-0`, f % 4 === 0 ? 'support' : 'dealer', 1735, 3000 + ((f * 23) % 12) * 100] as C]]),
    ]));
    const times: string[] = [];
    for (const [many, few, limitMs] of [[2, 6, 1000], [2, 1, 1000], [4, 4, 1000], [5, 1, 1000], [5, 3, 1000], [4, 12, 3000], [8, 8, 3000], [10, 6, 3000], [15, 1, 3000]] as const) {
      const fs = lopsided(many, few);
      for (const raid of [serkaHard, kazerosHard]) {
        const t0 = performance.now();
        const r = planRaid({ raid, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
        const ms = performance.now() - t0;
        expect(ms).toBeLessThan(limitMs);
        const alt = r.candidates.find((c) => c.kind === 'fullPlacement');
        if (alt) {
          expect(alt.summary.characterCount).toBeGreaterThan(r.candidates[0].summary.characterCount);
          expect(r.candidates.at(-1)).toBe(alt);
        }
        times.push(`${many}x6+${few}x1 ${raid.size}인 ${ms.toFixed(0)}ms(${r.candidates[0].summary.characterCount}${alt ? `→대안 ${alt.summary.characterCount}` : ', 대안 없음'})`);
      }
    }
    console.log(`[성능] 대안: ${times.join(', ')}`);
  });

  it('딜러만 8명 x 6캐릭터, 8인 레이드도 1초 안 (공대 8개, 모두 편성)', () => {
    const fs = makeFriends(Object.fromEntries(Array.from({ length: 8 }, (_, f) => [
      `d${f}`, Array.from({ length: 6 }, (_, k): C => [`d${f}-${k}`, 'dealer', 1735, 2500 + ((f * 7 + k * 13) % 20) * 100]),
    ])));
    const t0 = performance.now();
    const r = planRaid({ raid: kazerosHard, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id) });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(r.candidates[0].parties).toHaveLength(8);
    expect(r.candidates[0].unplaced).toEqual([]);
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
  // 순위 키: 편성 수 → 외부 총 인원 → 외부 서포터 → 최악 단계 → 그 단계 공대 수 → 숙련자 없는 공대 수 → 클경 2명 이상 공대 수 → 숙련도 점수 차 → imbalance
  const profRankKey = (c: Candidate) =>
    [-chosenNames(c).length, extTotal(c), extSupports(c), worst(c), worstCount(c), noExpertParties(c), multiClkParties(c), devRange(c), c.imbalance]
      .map(pad).join('|');
  const singles = (ids: string[]) =>
    makeFriends(Object.fromEntries(ids.map((id) => [id, [[`${id}1`, 'dealer', 1715, 3000]] as C[]])));

  // 친구 6명(딜러 1개씩) → 공대 2개. 전투력만 보면 숙련 둘(e1, e2)이 한 공대에 묶이는 편이 균형이 가장 좋다
  // ({4500,2900,3700} / {4400,3000,3700} = 둘 다 3,700)
  const six = makeFriends({
    e1: [['e1', 'dealer', 1715, 4500]], e2: [['e2', 'dealer', 1715, 2900]],
    k1: [['k1', 'dealer', 1715, 4400]], k2: [['k2', 'dealer', 1715, 3000]],
    n1: [['n1', 'dealer', 1715, 3700]], n2: [['n2', 'dealer', 1715, 3700]],
  });
  const sixIds = six.map((f) => f.id);
  const sixProf = lookup({ e1: '숙련', e2: '숙련', k1: '클경', k2: '클경' });
  const together = (c: Candidate) => c.parties.some((p) => count(p, '숙련') === 2);

  it('proficiencyTracked: 대상 캐릭터 중 하나라도 숙련도를 직접 정했으면(반숙 포함) true, 아무것도 없으면 false', () => {
    const base = { raid: serkaNormal, friends: six, clears: [], attendeeIds: sixIds };
    expect(planRaid(base).proficiencyTracked).toBe(false);
    expect(planRaid({ ...base, proficiency: () => undefined }).proficiencyTracked).toBe(false);
    expect(planRaid({ ...base, proficiency: (_f, n) => (n === 'k2' ? '반숙' : undefined) }).proficiencyTracked).toBe(true);
    expect(planRaid({ ...base, proficiency: () => '클경' }).proficiencyTracked).toBe(true);
    // 대상이 아닌 캐릭터(참석 안 함)에만 값이 있으면 추적하지 않는 것으로 본다
    expect(planRaid({ ...base, attendeeIds: ['e1', 'e2'], proficiency: (_f, n) => (n === 'k1' ? '숙련' : undefined) }).proficiencyTracked).toBe(false);
    // 정하지 않은 칸(undefined)은 반숙으로 계산: 아무것도 없을 때 결과는 숙련도를 안 준 것과 같다
    const none = planRaid({ ...base, limit: 50 });
    const unset = planRaid({ ...base, limit: 50, proficiency: () => undefined });
    expect(unset).toEqual(none);
  });

  it('숙련도를 주지 않으면 모두 반숙: 친구 자리에 반숙, 공대 요약은 숙련 0 (숙련자 없음), 전투력 균형은 그대로', () => {
    const r = planRaid({ raid: serkaNormal, friends: six, clears: [], attendeeIds: sixIds });
    const top = r.candidates[0];
    for (const p of top.parties) {
      expect(friendSlots(p).every((s) => s.proficiency === '반숙')).toBe(true);
      expect(p.proficiency).toEqual({ 숙련: 0, 반숙: friendSlots(p).length, 클경: 0, noExpert: true });
    }
    expect(top.imbalance).toBe(0);
  });

  it('(a) 숙련 2 + 클경 2 + 반숙 2, 공대 2개 → 공대마다 숙련 1명, 클경도 1명씩 (전투력 균형보다 먼저)', () => {
    const r = planRaid({ raid: serkaNormal, friends: six, clears: [], attendeeIds: sixIds, proficiency: sixProf });
    const top = r.candidates[0];
    expect(top.parties).toHaveLength(2);
    for (const p of top.parties) {
      expect(p.tier).toBe('comfortable');
      expect(count(p, '숙련')).toBe(1);
      expect(count(p, '클경')).toBe(1);
      expect(p.proficiency).toEqual({ 숙련: 1, 반숙: 1, 클경: 1, noExpert: false });
    }
    expect(top.imbalance).toBeGreaterThan(0);
  });

  it('(b) 단계·외부 인원이 같으면 숙련자를 한 공대에 모은 편성은 나눈 편성보다 항상 뒤에 온다', () => {
    const r = planRaid({ raid: serkaNormal, friends: six, clears: [], attendeeIds: sixIds, proficiency: sixProf, limit: 1000 });
    const flags = r.candidates.map(together);
    expect(flags.includes(true)).toBe(true);
    expect(flags.includes(false)).toBe(true);
    expect(flags.indexOf(true)).toBeGreaterThan(flags.lastIndexOf(false));
    expect(r.candidates.find(together)!.parties.some((p) => p.proficiency!.noExpert)).toBe(true);
  });

  it('(c) 외부 자리는 숙련자로 세지 않는다 (숙련이 한 명뿐이면 다른 공대는 숙련자 없음)', () => {
    const fs = singles(['a', 'b', 'c', 'd', 'e', 'f']);
    const r = planRaid({ raid: serkaNormal, friends: fs, clears: [], attendeeIds: fs.map((f) => f.id), proficiency: lookup({ a1: '숙련' }), limit: 50 });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.parties).toHaveLength(2);
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

  it('[정렬] 숙련도가 섞여도 순위 키(편성 수 → 외부 → 단계 → 숙련도 균형 → imbalance)대로 정렬된다', () => {
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
});
