import { eligibleCharacters } from './eligibility';
import type { Candidate, Character, ClearRecord, Friend, Party, PlanResult, PlanSummary, RaidConfig, Slot, Tier } from './types';

/**
 * 공대 편성 (설계 수정 2026-10-16-multi-run-planning-amendment.md).
 *
 * - 참석한 친구의 캐릭터 중 갈 수 있고 이번 주에 안 간 캐릭터를 **모두 한 번씩** 어느 공대엔가 넣는다.
 * - 한 공대에 같은 친구는 한 번만, 같은 친구가 다른 공대에 다른 캐릭터로 들어가는 것은 된다.
 * - 공대 수 P는 최소: max(친구별 캐릭터 수, ceil(딜러/딜러 자리), ceil(서포터/서포터 자리), ceil(캐릭터/인원)).
 *   (이 P에서는 항상 배정이 존재한다: 서포터 자리 s개, 딜러 자리 d개로 역할 꼭짓점을 쪼갠 이분 그래프의 최대 차수가
 *   P 이하라 König 정리로 P색 간선 칠하기가 된다. 그래도 탐색이 못 찾으면 P+1까지 시도한다.)
 * - 탐색은 결정적 휴리스틱: 여러 번 (고정 시드) 초기 배정 → 딜러 교환/이동으로 국소 개선 → 이웃 배정까지 모아
 *   중복(공대 순서만 다른 것)을 빼고 순위대로 상위 limit개.
 */

/** 권장 최소 전투력의 이 비율 이상이면 'tight', 미만이면 'risky'. 조정 가능한 상수. */
export const TIGHT_RATIO = 0.9;

/** 레이드 하나에 돌려주는 추천 수 기본값. */
export const DEFAULT_PLAN_LIMIT = 3;

// 정렬에서 "나쁜" 정도. risky > tight > unknown > comfortable
const TIER_BADNESS: Record<Tier, number> = { comfortable: 0, unknown: 1, tight: 2, risky: 3 };

const NO_ELIGIBLE_REASON = '참석할 수 있는 캐릭터가 없어요';
const NO_LAYOUT_REASON = '공대를 짤 수 없어요. 클리어 표시나 참석자를 바꿔 보세요.';

/**
 * 탐색량: 초기 배정 횟수, 국소 개선 반복 상한, 초기 배정 백트래킹 상한, 이웃 배정 수 상한,
 * 개선이 막혔을 때 시도하는 점수 그대로인 이동(서포터 이동/교환) 수 상한.
 * 캐릭터 수 n이 크면 조작 하나를 평가하는 값이 커지므로 재시작/시도 수를 줄인다
 * (n ≤ 37: 16번/200번, 48: 12번/125번, 96: 6번/62번).
 */
const restartsFor = (n: number) => Math.max(6, Math.min(16, Math.floor(600 / n)));
const kickLimitFor = (n: number) => Math.max(32, Math.min(200, Math.floor(6000 / n)));
const MAX_PASSES = 40;
const BUILD_STEP_BUDGET = 20_000;
const NEIGHBOR_BUDGET = 4_000;
const EPS = 1e-9;

export function tierFor(avg: number | null, raid: RaidConfig): Tier {
  if (avg === null) return 'unknown';
  if (avg >= raid.recommendedCP.min) return 'comfortable';
  if (avg >= raid.recommendedCP.min * TIGHT_RATIO) return 'tight';
  return 'risky';
}

interface Item { friendId: string; friend: number; character: Character; support: boolean; cp: number | null; }

/** 고정 시드 난수 (mulberry32). 같은 입력이면 같은 결과. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 점수: 최악 단계 → 그 단계인 공대 수 → imbalance → 평균 분산(동률 깨기). 작을수록 좋다. */
interface Score { worst: number; worstCount: number; imbalance: number; spread: number; }
const compareScore = (a: Score, b: Score) =>
  a.worst - b.worst || a.worstCount - b.worstCount
  || (Math.abs(a.imbalance - b.imbalance) > EPS ? a.imbalance - b.imbalance : 0)
  || (Math.abs(a.spread - b.spread) > EPS ? a.spread - b.spread : 0);
/** 분산(동률 깨기)을 뺀 비교. 점수 그대로인 조작 뒤의 개선은 이 기준으로 좋아질 때만 받아들인다. */
const compareMain = (a: Score, b: Score) =>
  a.worst - b.worst || a.worstCount - b.worstCount || (Math.abs(a.imbalance - b.imbalance) > EPS ? a.imbalance - b.imbalance : 0);

/** 배정 상태: item → 공대. 공대별 친구 수/역할 수/딜러 전투력 합을 같이 들고 다닌다. */
class Layout {
  readonly assign: Int32Array;
  readonly has: Int32Array; // [party * F + friend] 그 공대에 그 친구 캐릭터 수 (0 또는 1)
  readonly sup: Int32Array;
  readonly deal: Int32Array;
  readonly size: Int32Array;
  readonly cpSum: Float64Array;
  readonly cpN: Int32Array;
  constructor(readonly ctx: Ctx) {
    const { items, P, F } = ctx;
    this.assign = new Int32Array(items.length).fill(-1);
    this.has = new Int32Array(P * F);
    this.sup = new Int32Array(P);
    this.deal = new Int32Array(P);
    this.size = new Int32Array(P);
    this.cpSum = new Float64Array(P);
    this.cpN = new Int32Array(P);
  }
  canPlace(i: number, p: number): boolean {
    const it = this.ctx.items[i];
    if (this.has[p * this.ctx.F + it.friend]) return false;
    return it.support ? this.sup[p] < this.ctx.supportSlots : this.deal[p] < this.ctx.dealerSlots;
  }
  place(i: number, p: number) {
    const it = this.ctx.items[i];
    this.assign[i] = p;
    this.has[p * this.ctx.F + it.friend]++;
    this.size[p]++;
    if (it.support) this.sup[p]++;
    else {
      this.deal[p]++;
      if (it.cp !== null) { this.cpSum[p] += it.cp; this.cpN[p]++; }
    }
  }
  remove(i: number) {
    const it = this.ctx.items[i];
    const p = this.assign[i];
    this.assign[i] = -1;
    this.has[p * this.ctx.F + it.friend]--;
    this.size[p]--;
    if (it.support) this.sup[p]--;
    else {
      this.deal[p]--;
      if (it.cp !== null) { this.cpSum[p] -= it.cp; this.cpN[p]--; }
    }
  }
  score(): Score {
    const { P, raid } = this.ctx;
    let worst = 0;
    let worstCount = 0;
    let max = -Infinity;
    let min = Infinity;
    let sum = 0;
    let n = 0;
    let sq = 0;
    for (let p = 0; p < P; p++) {
      const avg = this.cpN[p] ? this.cpSum[p] / this.cpN[p] : null;
      const b = TIER_BADNESS[tierFor(avg, raid)];
      if (b > worst) { worst = b; worstCount = 1; } else if (b === worst) worstCount++;
      if (avg !== null) {
        if (avg > max) max = avg;
        if (avg < min) min = avg;
        sum += avg;
        sq += avg * avg;
        n++;
      }
    }
    return { worst, worstCount, imbalance: n ? max - min : 0, spread: n ? sq / n - (sum / n) ** 2 : 0 };
  }
  clone(): Layout {
    const l = new Layout(this.ctx);
    l.assign.set(this.assign); l.has.set(this.has); l.sup.set(this.sup); l.deal.set(this.deal);
    l.size.set(this.size); l.cpSum.set(this.cpSum); l.cpN.set(this.cpN);
    return l;
  }
  key(): string {
    const groups: string[][] = Array.from({ length: this.ctx.P }, () => []);
    this.ctx.items.forEach((it, i) => groups[this.assign[i]].push(it.character.name));
    return groups.map((g) => g.sort().join('\u0001')).sort().join('\u0002');
  }
  /** 딜러 배치만의 키 (서포터 자리만 바꾼 추천과 구별). */
  dealerKey(): string {
    const groups: string[][] = Array.from({ length: this.ctx.P }, () => []);
    this.ctx.items.forEach((it, i) => { if (!it.support) groups[this.assign[i]].push(it.character.name); });
    return groups.map((g) => g.sort().join('\u0001')).sort().join('\u0002');
  }
}

interface Ctx {
  raid: RaidConfig; items: Item[]; P: number; F: number; supportSlots: number; dealerSlots: number;
  charsPerFriend: number[];
}

type Mode = 'strong-first' | 'snake' | 'random';

/**
 * 초기 배정: 서포터 먼저(캐릭터 많은 친구부터), 그다음 딜러. 공대 선택 순서는 mode에 따라 다르고,
 * 막히면 되돌아가 다른 공대를 시도한다(단계 상한 BUILD_STEP_BUDGET). 실패하면 null.
 */
function build(ctx: Ctx, mode: Mode, rand: () => number): Layout | null {
  const { items, P } = ctx;
  const jitter = items.map(() => rand());
  const idx = items.map((_, i) => i);
  const sups = idx.filter((i) => items[i].support)
    .sort((a, b) => ctx.charsPerFriend[items[b].friend] - ctx.charsPerFriend[items[a].friend] || jitter[a] - jitter[b]);
  const deals = idx.filter((i) => !items[i].support);
  if (mode === 'random') {
    deals.sort((a, b) => ctx.charsPerFriend[items[b].friend] - ctx.charsPerFriend[items[a].friend] || jitter[a] - jitter[b]);
  } else {
    deals.sort((a, b) => (items[b].cp ?? -1) - (items[a].cp ?? -1) || a - b);
  }
  const order = [...sups, ...deals];
  const L = new Layout(ctx);
  const pj = Array.from({ length: P }, () => rand());
  let steps = 0;
  let dealt = 0;
  const prefs = (k: number): number[] => {
    const i = order[k];
    const ps = Array.from({ length: P }, (_, p) => p);
    if (items[i].support) return ps.sort((a, b) => L.sup[a] - L.sup[b] || L.size[a] - L.size[b] || pj[a] - pj[b]);
    if (mode === 'strong-first') {
      // 빈 공대 먼저, 그다음 딜러 전투력 합이 가장 작은 공대
      return ps.sort((a, b) => Number(L.size[a] > 0) - Number(L.size[b] > 0) || L.cpSum[a] - L.cpSum[b] || L.deal[a] - L.deal[b] || a - b);
    }
    if (mode === 'snake') {
      const round = Math.floor(dealt / P);
      const pos = dealt % P;
      const target = round % 2 === 0 ? pos : P - 1 - pos;
      return ps.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    }
    return ps.sort((a, b) => L.deal[a] - L.deal[b] || L.size[a] - L.size[b] || pj[a] - pj[b]);
  };
  const walk = (k: number): boolean => {
    if (k === order.length) return true;
    if (++steps > BUILD_STEP_BUDGET) return false;
    const i = order[k];
    for (const p of prefs(k)) {
      if (!L.canPlace(i, p)) continue;
      L.place(i, p);
      if (!items[i].support) dealt++;
      if (walk(k + 1)) return true;
      if (!items[i].support) dealt--;
      L.remove(i);
      if (steps > BUILD_STEP_BUDGET) return false;
    }
    return false;
  };
  if (!walk(0)) return null;
  for (let p = 0; p < P; p++) if (L.size[p] === 0) return null; // 빈 공대는 쓸모없는 배정
  return L;
}

/**
 * 서로 다른 공대의 두 캐릭터 교환이 규칙을 지키는지. 역할이 달라도 된다(예: 같은 친구의 딜러와 서포터를
 * 맞바꿔 강한 딜러 옆자리를 비우기): 교환 뒤 두 공대 모두 서포터/딜러 자리 수를 넘지 않고 같은 친구가 겹치지 않으면 된다.
 */
function canSwap(L: Layout, i: number, j: number): boolean {
  const { items, F, supportSlots, dealerSlots } = L.ctx;
  const pa = L.assign[i];
  const pb = L.assign[j];
  if (pa === pb) return false;
  const a = items[i];
  const b = items[j];
  if (a.support !== b.support) {
    // pa: a를 내보내고 b를 받는다 / pb: 반대
    const into = (p: number, inSup: boolean) =>
      inSup ? L.sup[p] + 1 <= supportSlots : L.deal[p] + 1 <= dealerSlots;
    if (!into(pa, b.support) || !into(pb, a.support)) return false;
  }
  if (a.friend === b.friend) return true;
  return !L.has[pb * F + a.friend] && !L.has[pa * F + b.friend];
}

function swap(L: Layout, i: number, j: number) {
  const pa = L.assign[i];
  const pb = L.assign[j];
  L.remove(i); L.remove(j);
  L.place(i, pb); L.place(j, pa);
}

/** 이동: i를 q 공대로 (빈 공대를 만들지 않는다). */
function canMove(L: Layout, i: number, q: number): boolean {
  return L.assign[i] !== q && L.size[L.assign[i]] > 1 && L.canPlace(i, q);
}

function move(L: Layout, i: number, q: number) {
  L.remove(i);
  L.place(i, q);
}

/** 점수가 바뀌지 않는 조작인지 (서포터끼리, 전투력 없는 캐릭터끼리). 일반 탐색에서는 건너뛴다. */
const neutral = (items: Item[], i: number, j: number) => items[i].cp === items[j].cp && items[i].support === items[j].support;

/**
 * 공대 touched(1~2개)에 걸친 교환/이동 중 점수가 (분산 말고) 좋아지는 첫 조작을 적용한다. 적용했으면 새 점수, 없으면 null.
 * 점수 그대로인 조작(서포터 이동 등) 뒤에 새로 가능해진 개선을 찾는 데 쓴다.
 */
function improveAround(L: Layout, touched: number[], cur: Score): Score | null {
  const { items, P } = L.ctx;
  const n = items.length;
  for (let i = 0; i < n; i++) {
    const inside = touched.includes(L.assign[i]);
    if (inside) {
      for (let j = 0; j < n; j++) {
        if (i === j || neutral(items, i, j) || !canSwap(L, i, j)) continue;
        swap(L, i, j);
        const s = L.score();
        if (compareMain(s, cur) < 0) return s;
        swap(L, i, j);
      }
    }
    if (items[i].cp === null) continue;
    for (let q = 0; q < P; q++) {
      if (!(inside || touched.includes(q)) || !canMove(L, i, q)) continue;
      const from = L.assign[i];
      move(L, i, q);
      const s = L.score();
      if (compareMain(s, cur) < 0) return s;
      move(L, i, from);
    }
  }
  return null;
}

/**
 * 국소 개선: 모든 캐릭터(서포터 포함, 역할이 다른 교환 포함)의 교환/이동으로 점수(최악 단계 → 그 단계 공대 수 →
 * imbalance → 분산)가 좋아지는 동안 반복한다. 더 좋아지지 않으면 점수 그대로인 서포터 이동/교환을 하나 해 보고
 * 그 덕에 생긴 개선이 있을 때만 받아들인다(최대 kickLimitFor(n)번 시도). 받아들인 조작은 항상 점수를 낮추므로 끝난다.
 */
function improve(L: Layout): Score {
  const { items, P } = L.ctx;
  const n = items.length;
  const kickLimit = kickLimitFor(n);
  let cur = L.score();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (neutral(items, i, j) || !canSwap(L, i, j)) continue;
        swap(L, i, j);
        const s = L.score();
        if (compareScore(s, cur) < 0) { cur = s; improved = true; } else swap(L, i, j);
      }
    }
    for (let i = 0; i < n; i++) {
      if (items[i].cp === null) continue; // 서포터/전투력 없는 딜러 이동은 점수가 그대로
      for (let q = 0; q < P; q++) {
        if (!canMove(L, i, q)) continue;
        const from = L.assign[i];
        move(L, i, q);
        const s = L.score();
        if (compareScore(s, cur) < 0) { cur = s; improved = true; } else move(L, i, from);
      }
    }
    if (improved) continue;
    // 막혔다: 점수 그대로인 조작(전투력 없는 캐릭터의 이동, 그런 캐릭터끼리의 교환)으로 자리를 비워 본다.
    let kicks = 0;
    let kicked = false;
    outer: for (let i = 0; i < n && kicks < kickLimit; i++) {
      if (items[i].cp !== null) continue;
      for (let q = 0; q < P && kicks < kickLimit; q++) {
        if (!canMove(L, i, q)) continue;
        kicks++;
        const from = L.assign[i];
        move(L, i, q);
        const s = improveAround(L, [from, q], cur);
        if (s) { cur = s; kicked = true; break outer; }
        move(L, i, from);
      }
      for (let j = i + 1; j < n && kicks < kickLimit; j++) {
        if (!neutral(items, i, j) || !canSwap(L, i, j)) continue;
        kicks++;
        const pa = L.assign[i];
        const pb = L.assign[j];
        swap(L, i, j);
        const s = improveAround(L, [pa, pb], cur);
        if (s) { cur = s; kicked = true; break outer; }
        swap(L, i, j);
      }
    }
    if (!kicked) break;
  }
  return cur;
}

interface Found { layout: Layout; score: Score; key: string; }

/** P개 공대로 여러 배정을 찾는다. 하나도 못 찾으면 []. */
function search(ctx: Ctx): Found[] {
  const found = new Map<string, Found>();
  const add = (L: Layout, score: Score) => {
    const key = L.key();
    if (!found.has(key)) found.set(key, { layout: L.clone(), score, key });
  };
  const rand = rng(0x5eed + ctx.items.length * 31 + ctx.P);
  const modes: Mode[] = ['strong-first', 'snake'];
  const restarts = restartsFor(ctx.items.length);
  for (let r = 0; r < restarts; r++) {
    const L = build(ctx, modes[r] ?? 'random', rand);
    if (!L) continue;
    add(L, L.score());
    add(L, improve(L));
  }
  if (found.size === 0) return [];

  // 이웃 배정: 가장 좋은 몇 개에서 한 번 교환/이동한 배정도 후보로 (서로 다른 추천을 넉넉히 만들기 위해)
  const seeds = [...found.values()].sort((a, b) => compareScore(a.score, b.score) || (a.key < b.key ? -1 : 1)).slice(0, 3);
  const { items, P } = ctx;
  let budget = NEIGHBOR_BUDGET;
  for (const seed of seeds) {
    const L = seed.layout.clone();
    for (let i = 0; i < items.length && budget > 0; i++) {
      for (let j = i + 1; j < items.length && budget > 0; j++) {
        if (!canSwap(L, i, j)) continue;
        budget--;
        swap(L, i, j);
        add(L, L.score());
        swap(L, i, j);
      }
      for (let q = 0; q < P && budget > 0; q++) {
        if (!canMove(L, i, q)) continue;
        budget--;
        const from = L.assign[i];
        move(L, i, q);
        add(L, L.score());
        move(L, i, from);
      }
    }
  }
  return [...found.values()];
}

/** 배정 → 화면용 Candidate. 공대 순서: 친구 많은 공대 → 딜러 평균 높은 공대 → 이름순. */
function toCandidate(f: Found): Candidate {
  const L = f.layout;
  const { items, P, raid, supportSlots } = L.ctx;
  const parties: (Party & { key: string; friends: number })[] = [];
  for (let p = 0; p < P; p++) {
    const members = items.map((it, i) => ({ it, i })).filter(({ i }) => L.assign[i] === p);
    const sups = members.filter(({ it }) => it.support).length;
    const extSupports = supportSlots - sups;
    const extDealers = raid.size - members.length - extSupports;
    const slots: Slot[] = [
      ...members.map(({ it }): Slot => ({ kind: 'friend', friendId: it.friendId, character: it.character })),
      ...Array.from({ length: extSupports }, (): Slot => ({ kind: 'external', role: 'support' })),
      ...Array.from({ length: extDealers }, (): Slot => ({ kind: 'external', role: 'dealer' })),
    ];
    // 증감으로 쌓인 합 대신 구성원으로 다시 계산 (소수 전투력의 오차 방지)
    const cps = members.flatMap(({ it }) => (it.cp === null ? [] : [it.cp]));
    const dealerAvgCP = cps.length ? cps.reduce((x, y) => x + y, 0) / cps.length : null;
    parties.push({
      slots, dealerAvgCP, tier: tierFor(dealerAvgCP, raid),
      key: members.map(({ it }) => it.character.name).sort().join('\u0001'), friends: members.length,
    });
  }
  parties.sort((a, b) => b.friends - a.friends || (b.dealerAvgCP ?? -Infinity) - (a.dealerAvgCP ?? -Infinity) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const clean: Party[] = parties.map(({ slots, dealerAvgCP, tier }) => ({ slots, dealerAvgCP, tier }));
  const avgs = clean.flatMap((p) => (p.dealerAvgCP === null ? [] : [p.dealerAvgCP]));
  const imbalance = avgs.length ? Math.max(...avgs) - Math.min(...avgs) : 0;
  return { parties: clean, summary: summarize(clean), imbalance };
}

export function summarize(parties: Party[]): PlanSummary {
  const friendIds = new Set<string>();
  let characterCount = 0;
  let externalSupports = 0;
  let externalDealers = 0;
  for (const p of parties) {
    for (const s of p.slots) {
      if (s.kind === 'friend') { friendIds.add(s.friendId); characterCount++; }
      else if (s.role === 'support') externalSupports++;
      else externalDealers++;
    }
  }
  return {
    friendCount: friendIds.size, characterCount, partyCount: parties.length,
    externalCount: externalSupports + externalDealers, externalSupports, externalDealers,
  };
}

/** 순위(설계 수정 5번): 외부 서포터 수 → 외부 총 인원 → 최악 단계 → imbalance. */
function compareFound(a: Found & { ext: [number, number] }, b: Found & { ext: [number, number] }): number {
  return a.ext[0] - b.ext[0] || a.ext[1] - b.ext[1] || compareScore(a.score, b.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export function planRaid(input: {
  raid: RaidConfig;
  friends: Friend[];
  clears: ClearRecord[];
  attendeeIds: string[];
  limit?: number;
}): PlanResult {
  const { raid, friends, clears, attendeeIds, limit = DEFAULT_PLAN_LIMIT } = input;
  const excluded: PlanResult['excluded'] = [];
  const attendees = new Set(attendeeIds);
  const items: Item[] = [];
  const charsPerFriend: number[] = [];
  // 방어: 두 친구에 같은 이름의 캐릭터가 있으면 먼저 나온 친구의 것만 쓴다 (한 추천에 같은 캐릭터가 두 번 놓이지 않게).
  const claimed = new Set<string>();
  for (const f of friends) {
    if (!attendees.has(f.id)) continue;
    const eligible = eligibleCharacters(f, raid, clears).filter((c) => !claimed.has(c.name));
    for (const c of eligible) claimed.add(c.name);
    if (eligible.length === 0) { excluded.push({ friendId: f.id, reason: '가능한 캐릭터 없음' }); continue; }
    const friend = charsPerFriend.length;
    charsPerFriend.push(eligible.length);
    for (const c of eligible) {
      items.push({ friendId: f.id, friend, character: c, support: c.role === 'support', cp: c.role === 'support' ? null : c.combatPower });
    }
  }
  if (items.length === 0) {
    return excluded.length ? { candidates: [], excluded, reason: NO_ELIGIBLE_REASON } : { candidates: [], excluded };
  }

  const supportSlots = raid.size / 4;
  const dealerSlots = raid.size - supportSlots;
  const supports = items.filter((it) => it.support).length;
  const dealers = items.length - supports;
  const minP = Math.max(
    1,
    ...charsPerFriend,
    Math.ceil(dealers / dealerSlots),
    Math.ceil(supports / supportSlots),
    Math.ceil(items.length / raid.size),
  );

  for (const P of [minP, minP + 1]) {
    const ctx: Ctx = { raid, items, P, F: charsPerFriend.length, supportSlots, dealerSlots, charsPerFriend };
    const found = search(ctx);
    if (found.length === 0) continue;
    const extSupports = P * supportSlots - supports;
    const ranked = found.map((f) => ({ ...f, ext: [extSupports, P * raid.size - items.length] as [number, number] })).sort(compareFound);
    // 딜러 배치가 다른 추천을 먼저 고르고(서포터 자리만 바꾼 비슷한 추천이 위를 다 차지하지 않게), 남은 자리는 순위대로.
    const chosen = new Set<(typeof ranked)[number]>();
    const dealerKeys = new Set<string>();
    for (const f of ranked) {
      if (chosen.size >= limit) break;
      const dk = f.layout.dealerKey();
      if (!dealerKeys.has(dk)) { dealerKeys.add(dk); chosen.add(f); }
    }
    for (const f of ranked) {
      if (chosen.size >= limit) break;
      chosen.add(f);
    }
    const picked = ranked.filter((f) => chosen.has(f));
    return { candidates: picked.map(toCandidate), excluded };
  }
  return { candidates: [], excluded, reason: NO_LAYOUT_REASON };
}
