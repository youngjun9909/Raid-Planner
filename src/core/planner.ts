import { eligibleCharacters } from './eligibility';
import type { Candidate, Character, ClearRecord, Friend, Party, PlanResult, RaidConfig, Slot, Tier } from './types';

/** 권장 최소 전투력의 이 비율 이상이면 'tight', 미만이면 'risky'. 조정 가능한 상수. */
export const TIGHT_RATIO = 0.9;

/**
 * 가지치기: 친구마다 전투력(null은 최하위, 동률이면 아이템 레벨) 상위 딜러 MAX_DEALERS명과
 * 상위 서포터 MAX_SUPPORTS명만 후보로 본다. 친구당 선택지가 최대 3개라 8명이어도 3^8 = 6,561 조합이고,
 * 공대가 둘 이상이면 공대별로 따로 펼친 뒤 곱하므로 8명 x 6캐릭터도 수십 ms 안에 끝난다.
 * 낮은 캐릭터를 골라야만 나오는 조합(예: 균형을 맞추려 일부러 약한 딜러를 넣는 경우)은 상위 2딜러 안에서만 고려된다.
 */
const MAX_DEALERS = 2;
const MAX_SUPPORTS = 1;

// 정렬에서 "나쁜" 정도. risky > tight > unknown > comfortable
const TIER_BADNESS: Record<Tier, number> = { comfortable: 0, unknown: 1, tight: 2, risky: 3 };

export function tierFor(avg: number | null, raid: RaidConfig): Tier {
  if (avg === null) return 'unknown';
  if (avg >= raid.recommendedCP.min) return 'comfortable';
  if (avg >= raid.recommendedCP.min * TIGHT_RATIO) return 'tight';
  return 'risky';
}

/** items를 정확히 k개의 비지 않은 그룹(각 크기 ≤ cap)으로 나누는 모든 방법. 그룹 순서는 무시(중복 없음). */
export function partitions<T>(items: T[], k: number, cap: number): T[][][] {
  const out: T[][][] = [];
  const groups: T[][] = [];
  const walk = (i: number) => {
    if (items.length - i < k - groups.length) return; // 남은 항목으로 빈 그룹을 다 못 채움
    if (i === items.length) {
      if (groups.length === k) out.push(groups.map((g) => [...g]));
      return;
    }
    for (const g of groups) {
      if (g.length < cap) {
        g.push(items[i]);
        walk(i + 1);
        g.pop();
      }
    }
    if (groups.length < k) {
      groups.push([items[i]]);
      walk(i + 1);
      groups.pop();
    }
  };
  walk(0);
  return out;
}

/** 데카르트 곱. product([[1,2],[3]]) → [[1,3],[2,3]] */
export function product<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((x) => [...prefix, x])), [[]]);
}

const byStrength = (a: Character, b: Character) =>
  (b.combatPower ?? -Infinity) - (a.combatPower ?? -Infinity) || b.itemLevel - a.itemLevel;

function pruneChoices(chars: Character[]): Character[] {
  const sorted = [...chars].sort(byStrength);
  return [
    ...sorted.filter((c) => c.role === 'dealer').slice(0, MAX_DEALERS),
    ...sorted.filter((c) => c.role === 'support').slice(0, MAX_SUPPORTS),
  ];
}

interface Pick { friendId: string; character: Character; }

interface PartyOption { party: Party; externals: number; extSupports: number; }

function buildParty(picks: Pick[], raid: RaidConfig): PartyOption | null {
  const supportSlots = raid.size / 4;
  const supports = picks.filter((p) => p.character.role === 'support').length;
  if (supports > supportSlots) return null;
  const extSupports = supportSlots - supports;
  const extDealers = raid.size - picks.length - extSupports;
  if (extDealers < 0) return null; // 서포터 자리가 남았는데 친구 딜러로 꽉 참 → 서포터를 넣을 자리가 없음
  const slots: Slot[] = [
    ...picks.map((p): Slot => ({ kind: 'friend', friendId: p.friendId, character: p.character })),
    ...Array.from({ length: extSupports }, (): Slot => ({ kind: 'external', role: 'support' })),
    ...Array.from({ length: extDealers }, (): Slot => ({ kind: 'external', role: 'dealer' })),
  ];
  const cps = picks
    .filter((p) => p.character.role === 'dealer' && p.character.combatPower !== null)
    .map((p) => p.character.combatPower as number);
  const dealerAvgCP = cps.length ? cps.reduce((s, v) => s + v, 0) / cps.length : null;
  return { party: { slots, dealerAvgCP, tier: tierFor(dealerAvgCP, raid) }, externals: extSupports + extDealers, extSupports };
}

const worstBadness = (c: Candidate) => Math.max(...c.parties.map((p) => TIER_BADNESS[p.tier]));
const externalSupportCount = (c: Candidate) =>
  c.parties.reduce((n, p) => n + p.slots.filter((s) => s.kind === 'external' && s.role === 'support').length, 0);

/** 전역 순위: externalCount → 외부 서포터 수(친구 서포터를 먼저 쓴다) → 최악 단계 → imbalance */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    a.externalCount - b.externalCount ||
    externalSupportCount(a) - externalSupportCount(b) ||
    worstBadness(a) - worstBadness(b) ||
    a.imbalance - b.imbalance
  );
}

function dedupeKey(c: Candidate): string {
  const chosen = c.parties
    .flatMap((p) => p.slots.flatMap((s) => (s.kind === 'friend' ? [`${s.friendId}:${s.character.name}`] : [])))
    .sort();
  return `${c.label}|${chosen.join(',')}`;
}

/**
 * 공대 하나의 구성 후보 순위 (공대별 상위 K개만 남길 때 사용):
 * 외부 서포터 수 → 단계 → 권장 범위 [min, max ?? min] 와의 거리(안쪽이면 0) → 평균 높은 순. 평균 null은 거리 무한대.
 * 범위에 가까운 구성끼리 묶이면 공대 간 imbalance도 작아진다.
 */
function partyOptionCompare(raid: RaidConfig) {
  const lo = raid.recommendedCP.min;
  const hi = raid.recommendedCP.max ?? lo;
  const dist = (avg: number | null) => (avg === null ? Infinity : avg < lo ? lo - avg : avg > hi ? avg - hi : 0);
  return (a: PartyOption, b: PartyOption) =>
    a.extSupports - b.extSupports ||
    TIER_BADNESS[a.party.tier] - TIER_BADNESS[b.party.tier] ||
    dist(a.party.dealerAvgCP) - dist(b.party.dealerAvgCP) ||
    (b.party.dealerAvgCP ?? -Infinity) - (a.party.dealerAvgCP ?? -Infinity);
}

/**
 * 탐색량 상한: 분배(그룹 나누기) 하나마다 공대별 구성 후보를 상위 K개만 남긴 뒤 공대끼리 곱한다.
 * K = max(2, floor((COMBINATION_BUDGET / 분배 수)^(1/공대 수))) 이므로 전체 후보 조합은 대략 COMBINATION_BUDGET 이하
 * (K 하한 2 때문에 분배 수가 아주 많으면 분배 수 x 2^P 까지). 예: 9명/8인 → 255분배, K=14 / 10명/4인 → 3675분배, K=2.
 * 작은 입력(예: 5명)은 K가 공대별 구성 수보다 커서 결과가 가지치기 없이 그대로다.
 * 같은 친구 묶음은 여러 분배에 반복해 나오므로 공대별 구성 목록은 묶음 단위로 캐시한다.
 */
const COMBINATION_BUDGET = 50_000;

const NO_ELIGIBLE_REASON = '참석할 수 있는 캐릭터가 없어요';
const NO_SUPPORT_ROOM_REASON = '서포터 자리를 채울 수 없어요. 서포터가 필요해요 (외부 서포터를 구해야 해요).';

/** 분배(라벨)마다 가장 좋은 후보를 먼저 하나씩 넣고, 남은 자리는 전역 순위로 채운 뒤 전역 순위로 정렬한다. */
function selectTop(all: Candidate[], limit: number): Candidate[] {
  const sorted = [...all].sort(compareCandidates);
  const chosen = new Set<Candidate>();
  const labels = new Set<string>();
  for (const c of sorted) {
    if (chosen.size >= limit) break;
    if (!labels.has(c.label)) { labels.add(c.label); chosen.add(c); }
  }
  for (const c of sorted) {
    if (chosen.size >= limit) break;
    chosen.add(c);
  }
  return sorted.filter((c) => chosen.has(c));
}

type PoolMember = { friendId: string; choices: Character[] };

export function planRaid(input: {
  raid: RaidConfig;
  friends: Friend[];
  clears: ClearRecord[];
  attendeeIds: string[];
  limit?: number;
}): PlanResult {
  const { raid, friends, clears, attendeeIds, limit = 5 } = input;
  const excluded: PlanResult['excluded'] = [];
  const pool: PoolMember[] = [];
  const attendees = new Set(attendeeIds);
  // 방어: 두 친구에 같은 이름의 캐릭터가 있으면 먼저 나온 친구의 것만 쓴다 (한 후보에 같은 캐릭터가 두 번 놓이지 않게).
  const claimed = new Set<string>();
  for (const f of friends) {
    if (!attendees.has(f.id)) continue;
    const eligible = eligibleCharacters(f, raid, clears).filter((c) => !claimed.has(c.name));
    for (const c of eligible) claimed.add(c.name);
    if (eligible.length === 0) excluded.push({ friendId: f.id, reason: '가능한 캐릭터 없음' });
    else pool.push({ friendId: f.id, choices: pruneChoices(eligible) });
  }
  if (pool.length === 0) {
    return excluded.length ? { candidates: [], excluded, reason: NO_ELIGIBLE_REASON } : { candidates: [], excluded };
  }

  const partyCount = Math.ceil(pool.length / raid.size);
  const groupings = partitions(pool, partyCount, raid.size);
  const topK = Math.max(2, Math.floor(Math.pow(COMBINATION_BUDGET / groupings.length, 1 / partyCount)));
  const byOption = partyOptionCompare(raid);
  const optionCache = new Map<string, PartyOption[]>();
  const optionsFor = (group: PoolMember[]): PartyOption[] => {
    const key = JSON.stringify(group.map((m) => m.friendId));
    let opts = optionCache.get(key);
    if (!opts) {
      opts = product(group.map((m) => m.choices.map((character): Pick => ({ friendId: m.friendId, character }))))
        .map((picks) => buildParty(picks, raid))
        .filter((x): x is PartyOption => x !== null)
        .sort(byOption)
        .slice(0, topK);
      optionCache.set(key, opts);
    }
    return opts;
  };

  const best = new Map<string, Candidate>();
  for (const groups of groupings) {
    const label = groups.map((g) => g.length).sort((x, y) => y - x).join('+');
    // 공대별로 가능한 구성(무효 제외, 상위 K개)을 먼저 만들고 공대끼리 곱한다.
    for (const combo of product(groups.map(optionsFor))) {
      const avgs = combo.map((o) => o.party.dealerAvgCP).filter((v): v is number => v !== null);
      const candidate: Candidate = {
        label,
        parties: combo.map((o) => o.party),
        externalCount: combo.reduce((s, o) => s + o.externals, 0),
        imbalance: avgs.length ? Math.max(...avgs) - Math.min(...avgs) : 0,
      };
      const key = dedupeKey(candidate);
      const prev = best.get(key);
      if (!prev || compareCandidates(candidate, prev) < 0) best.set(key, candidate);
    }
  }
  const candidates = selectTop([...best.values()], limit);
  // 남은 친구가 있는데 후보가 없으면: 모든 분배에서 서포터 자리를 둘 곳이 없다 (예: 딜러만 4명인 4인 레이드).
  return candidates.length ? { candidates, excluded } : { candidates, excluded, reason: NO_SUPPORT_ROOM_REASON };
}
