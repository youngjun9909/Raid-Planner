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

function buildParty(picks: Pick[], raid: RaidConfig): { party: Party; externals: number } | null {
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
  return { party: { slots, dealerAvgCP, tier: tierFor(dealerAvgCP, raid) }, externals: extSupports + extDealers };
}

const worstBadness = (c: Candidate) => Math.max(...c.parties.map((p) => TIER_BADNESS[p.tier]));

function compareCandidates(a: Candidate, b: Candidate): number {
  return a.externalCount - b.externalCount || worstBadness(a) - worstBadness(b) || a.imbalance - b.imbalance;
}

function dedupeKey(c: Candidate): string {
  const chosen = c.parties
    .flatMap((p) => p.slots.flatMap((s) => (s.kind === 'friend' ? [`${s.friendId}:${s.character.name}`] : [])))
    .sort();
  return `${c.label}|${chosen.join(',')}`;
}

export function planRaid(input: {
  raid: RaidConfig;
  friends: Friend[];
  clears: ClearRecord[];
  attendeeIds: string[];
  limit?: number;
}): PlanResult {
  const { raid, friends, clears, attendeeIds, limit = 5 } = input;
  const excluded: PlanResult['excluded'] = [];
  const pool: { friendId: string; choices: Character[] }[] = [];
  const attendees = new Set(attendeeIds);
  for (const f of friends) {
    if (!attendees.has(f.id)) continue;
    const eligible = eligibleCharacters(f, raid, clears);
    if (eligible.length === 0) excluded.push({ friendId: f.id, reason: '가능한 캐릭터 없음' });
    else pool.push({ friendId: f.id, choices: pruneChoices(eligible) });
  }
  if (pool.length === 0) return { candidates: [], excluded };

  const partyCount = Math.ceil(pool.length / raid.size);
  const best = new Map<string, Candidate>();
  for (const groups of partitions(pool, partyCount, raid.size)) {
    const label = groups.map((g) => g.length).sort((x, y) => y - x).join('+');
    // 공대별로 가능한 구성을 먼저 만들고(무효 제외), 공대끼리 곱한다.
    const optionsPerParty = groups.map((g) =>
      product(g.map((m) => m.choices.map((character): Pick => ({ friendId: m.friendId, character }))))
        .map((picks) => buildParty(picks, raid))
        .filter((x): x is NonNullable<typeof x> => x !== null),
    );
    for (const combo of product(optionsPerParty)) {
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
  return { candidates: [...best.values()].sort(compareCandidates).slice(0, limit), excluded };
}
