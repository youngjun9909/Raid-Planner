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

const serkaHard = getRaid('serka-hard')!; // 4인, 1730, 권장 3600~4000
const kazerosHard = getRaid('kazeros-hard')!; // 8인, 1730, 권장 3800~4200

const friendSlots = (p: Party) => p.slots.flatMap((s) => (s.kind === 'friend' ? [s] : []));
const roleOf = (s: Party['slots'][number]) => (s.kind === 'friend' ? s.character.role : s.role);
const chosenNames = (c: Candidate) => c.parties.flatMap((p) => friendSlots(p).map((s) => s.character.name));
const BAD: Record<Tier, number> = { comfortable: 0, unknown: 1, tight: 2, risky: 3 };
const worst = (c: Candidate) => Math.max(...c.parties.map((p) => BAD[p.tier]));
const extSupports = (c: Candidate) =>
  c.parties.flatMap((p) => p.slots).filter((s) => s.kind === 'external' && s.role === 'support').length;
// 전역 순위 키: externalCount → 외부 서포터 수 → 최악 단계 → imbalance (사전식 비교용 고정폭 문자열)
const rankKey = (c: Candidate) =>
  [c.externalCount, extSupports(c), worst(c), c.imbalance].map((n) => String(n.toFixed(3)).padStart(12, '0')).join('|');

describe('tierFor', () => {
  const raid = getRaid('serka-hard')!; // 권장 3600~4000
  it('null → unknown', () => expect(tierFor(null, raid)).toBe('unknown'));
  it('3600 이상 → comfortable', () => expect(tierFor(3600, raid)).toBe('comfortable'));
  it('3240~3599 → tight', () => expect(tierFor(3240, raid)).toBe('tight'));
  it('3239 → risky', () => expect(tierFor(3239, raid)).toBe('risky'));
  it('TIGHT_RATIO는 0.9', () => expect(TIGHT_RATIO).toBe(0.9));
});

describe('planRaid', () => {
  it('5명이 4인 레이드: 3+2와 4+1 분배가 모두 나온다', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    const labels = r.candidates.map((c) => c.label);
    expect(labels).toContain('3+2');
    expect(labels).toContain('4+1');
    expect(r.candidates.every((c) => c.parties.length === 2)).toBe(true);
  });

  it('기본 limit에서도 분배(3+2, 4+1)마다 최소 하나씩 나오고 전역 순위로 정렬된다 [Fix 1]', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL });
    expect(r.candidates).toHaveLength(5);
    const labels = r.candidates.map((c) => c.label);
    expect(labels).toContain('3+2');
    expect(labels).toContain('4+1');
    for (let i = 1; i < r.candidates.length; i++) {
      expect(rankKey(r.candidates[i - 1]) <= rankKey(r.candidates[i])).toBe(true);
    }
  });

  it('8인 레이드: 친구 서포터가 있으면 외부 서포터를 최소화한 후보가 맨 앞 [Fix 2]', () => {
    const r = planRaid({ raid: kazerosHard, friends, clears, attendeeIds: ALL });
    const top = r.candidates[0];
    expect(extSupports(top)).toBe(0);
    expect(chosenNames(top)).toEqual(expect.arrayContaining(['b-sup', 'c-sup']));
  });

  it('모든 공대 크기는 raid.size', () => {
    const r4 = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    expect(r4.candidates.flatMap((c) => c.parties).every((p) => p.slots.length === 4)).toBe(true);
    const r8 = planRaid({ raid: kazerosHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    expect(r8.candidates.flatMap((c) => c.parties).every((p) => p.slots.length === 8)).toBe(true);
  });

  it('한 공대에 같은 친구의 캐릭터는 하나뿐 (공대 사이에서도 중복 없음)', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      const ids = c.parties.flatMap((p) => friendSlots(p).map((s) => s.friendId));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(5);
    }
  });

  it('서포터 자리 수를 넘는 서포터는 배치되지 않는다 (4인: 공대당 서포터 ≤1)', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    for (const p of r.candidates.flatMap((c) => c.parties)) {
      expect(p.slots.filter((s) => roleOf(s) === 'support').length).toBe(1);
    }
    // b, c만 참석해 둘 다 서포터를 고르는 조합은 무효 → 한 명은 딜러로 간다
    const bc = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ['b', 'c'], limit: 1000 });
    expect(bc.candidates.length).toBeGreaterThan(0);
    for (const p of bc.candidates.flatMap((c) => c.parties)) {
      expect(p.slots.filter((s) => s.kind === 'friend' && s.character.role === 'support').length).toBeLessThanOrEqual(1);
    }
  });

  it('서포터 부족 시 external support로 채우고 externalCount에 반영', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ['d', 'e'] });
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      const slots = c.parties[0].slots;
      expect(slots).toContainEqual({ kind: 'external', role: 'support' });
      expect(slots.filter((s) => s.kind === 'external' && s.role === 'dealer').length).toBe(1);
      expect(c.externalCount).toBe(2);
    }
  });

  it('8인 레이드는 서포터 2자리', () => {
    const r = planRaid({ raid: kazerosHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    for (const p of r.candidates.flatMap((c) => c.parties)) {
      expect(p.slots.filter((s) => roleOf(s) === 'support').length).toBe(2);
    }
    expect(r.candidates.some((c) => ['b-sup', 'c-sup'].every((n) => chosenNames(c).includes(n)))).toBe(true);
  });

  it('입장 레벨 미달/클리어한 캐릭터는 어떤 후보에도 없다', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    const all = r.candidates.flatMap(chosenNames);
    expect(all).not.toContain('a-low');
    expect(all).not.toContain('e-cleared');
  });

  it('클리어로 가능한 캐릭터가 없는 친구는 excluded에 사유와 함께 들어간다 [Review Focus 1]', () => {
    const allCleared: ClearRecord[] = [...clears, { characterName: 'e-deal', raidName: '세르카', difficulty: '노말' }];
    const r = planRaid({ raid: serkaHard, friends, clears: allCleared, attendeeIds: ALL });
    expect(r.excluded).toEqual([{ friendId: 'e', reason: '가능한 캐릭터 없음' }]);
    expect(r.candidates.flatMap((c) => c.parties.flatMap(friendSlots)).some((s) => s.friendId === 'e')).toBe(false);
    // 남은 4명 → 공대 1개
    expect(r.candidates.every((c) => c.label === '4')).toBe(true);
  });

  it('서포터만 있는 공대는 dealerAvgCP null, tier unknown, 예외 없음 [Review Focus 2]', () => {
    const sOnly = makeFriends({ s: [['s-sup', 'support', 1740, 2600]] });
    const r = planRaid({ raid: serkaHard, friends: sOnly, clears: [], attendeeIds: ['s'] });
    expect(r.candidates).toHaveLength(1);
    const p = r.candidates[0].parties[0];
    expect(p.dealerAvgCP).toBeNull();
    expect(p.tier).toBe('unknown');
    expect(r.candidates[0].externalCount).toBe(3);
    expect(r.candidates[0].imbalance).toBe(0);
  });

  it('combatPower null 딜러는 평균에서 빠지고 평균이 NaN이 아니다 [Review Focus 3]', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ['a', 'd'], limit: 1000 });
    for (const p of r.candidates.flatMap((c) => c.parties)) {
      expect(p.dealerAvgCP === null || Number.isFinite(p.dealerAvgCP)).toBe(true);
    }
    const c = r.candidates.find((x) => chosenNames(x).includes('a-deal1') && chosenNames(x).includes('d-deal2'));
    expect(c?.parties[0].dealerAvgCP).toBe(3900);
    const onlyNull = planRaid({ raid: serkaHard, friends: makeFriends({ n: [['n-deal', 'dealer', 1740, null]] }), clears: [], attendeeIds: ['n'] });
    expect(onlyNull.candidates[0].parties[0].dealerAvgCP).toBeNull();
    expect(onlyNull.candidates[0].parties[0].tier).toBe('unknown');
  });

  it('참석자 0명이면 candidates [] 이고 예외 없음', () => {
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: [] })).toEqual({ candidates: [], excluded: [] });
  });

  it('정렬: externalCount → 외부 서포터 수 → 최악 단계 → imbalance (imbalance가 작은 후보가 앞선다)', () => {
    for (const raid of [serkaHard, kazerosHard]) {
      const r = planRaid({ raid, friends, clears, attendeeIds: ALL, limit: 1000 });
      expect(r.candidates.length).toBeGreaterThan(5);
      for (let i = 1; i < r.candidates.length; i++) {
        expect(rankKey(r.candidates[i - 1]) <= rankKey(r.candidates[i])).toBe(true);
      }
    }
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    // imbalance 계산: 공대별 평균의 최댓값 - 최솟값
    for (const c of r.candidates) {
      const avgs = c.parties.map((p) => p.dealerAvgCP).filter((v): v is number => v !== null);
      expect(c.imbalance).toBe(avgs.length ? Math.max(...avgs) - Math.min(...avgs) : 0);
    }
  });

  it('분배 라벨과 선택 캐릭터가 같은 후보는 중복 제거된다', () => {
    const r = planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 1000 });
    const keys = r.candidates.map((c) => c.label + '|' + [...chosenNames(c)].sort().join(','));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('limit 기본값 5', () => {
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL }).candidates).toHaveLength(5);
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL, limit: 2 }).candidates).toHaveLength(2);
  });

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
    return { r, ms: performance.now() - t0 };
  };

  it('8명 x 6캐릭터: 8인 레이드, 4인 레이드(공대 2개) 모두 1초 안에 끝난다', () => {
    for (const raid of [kazerosHard, serkaHard]) {
      const { r, ms } = timed(raid, 8);
      expect(r.candidates).toHaveLength(5);
      expect(ms).toBeLessThan(1000);
    }
  });

  it('9명 x 6캐릭터, 8인 레이드(공대 2개)도 2초 안에 끝난다 [Fix 3]', () => {
    const { r, ms } = timed(kazerosHard, 9);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.parties.length === 2)).toBe(true);
    expect(ms).toBeLessThan(2000);
  });

  it('10명 x 6캐릭터, 4인 레이드(공대 3개)도 2초 안에 끝난다 [Fix 3]', () => {
    const { r, ms } = timed(serkaHard, 10);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.parties.length === 3)).toBe(true);
    expect(new Set(r.candidates.map((c) => c.label))).toEqual(new Set(['4+4+2', '4+3+3']));
    expect(ms).toBeLessThan(2000);
  });

  it('딜러만 4명이 4인 레이드: 후보가 없고 서포터 부족 사유를 알려 준다 [Fix 4]', () => {
    const dealers = makeFriends({
      w: [['w1', 'dealer', 1740, 3600]], x: [['x1', 'dealer', 1740, 3600]],
      y: [['y1', 'dealer', 1740, 3600]], z: [['z1', 'dealer', 1740, 3600]],
    });
    const r = planRaid({ raid: serkaHard, friends: dealers, clears: [], attendeeIds: ['w', 'x', 'y', 'z'] });
    expect(r.candidates).toEqual([]);
    expect(r.reason).toBe('서포터 자리를 채울 수 없어요. 서포터가 필요해요 (외부 서포터를 구해야 해요).');
  });

  it('참석자 모두 가능한 캐릭터가 없으면 그 사유를 알려 준다 [Fix 4]', () => {
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

  it('참석자 0명이면 reason 없음, 후보가 있으면 reason 없음 [Fix 4]', () => {
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: [] }).reason).toBeUndefined();
    expect(planRaid({ raid: serkaHard, friends, clears, attendeeIds: ALL }).reason).toBeUndefined();
  });
});
