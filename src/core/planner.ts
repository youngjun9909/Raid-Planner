import { eligibleCharacters } from './eligibility';
import { DEFAULT_PROFICIENCY, summarizeProficiency } from './proficiency';
import type {
  Candidate, CandidateKind, Character, ClearRecord, Friend, Party, PlanResult, PlanSummary, Proficiency, RaidConfig, Slot, Tier, UnplacedCharacter,
} from './types';

/**
 * 공대 편성 (설계 수정 2026-10-16-friend-first-amendment.md C, multi-run/proficiency 수정 위에 얹음).
 *
 * - 후보 = 참석한 친구의 캐릭터 중 입장 레벨 이상, 이번 주에 그 레이드를 안 갔고, 가는 난이도 == 레이드 난이도인 캐릭터.
 * - 후보를 **전부** 편성하지 않는다. 캐릭터는 최대 한 번, 편성되지 못한 캐릭터는 추천의 unplaced.
 * - 공대마다 친구 캐릭터가 t명 이상: t = ceil(3/4·size), 그 기준으로 공대를 하나도 못 만들면 ceil(1/2·size), 그래도 안 되면 1.
 *   한 추천의 모든 공대는 같은 t (요약의 friendThreshold).
 * - 순위: ① 편성된 캐릭터 수(많이) → ② 외부 총 인원(적게) → ③ 외부 서포터(적게) → ④ 최악 단계 → ⑤ 그 단계 공대 수 →
 *   ⑥ 숙련도 균형(숙련자 없는 공대 수 → 클경 2명 이상 공대 수 → 숙련도 점수 차) → ⑦ 공대 간 딜러 평균 차.
 *
 * ①②③은 정확히 푼다. 공대 P개, 고른 캐릭터 집합 S에 대해 "친구마다 ≤ P개, 서포터 ≤ P·s, 딜러 ≤ P·d, |S| ≥ P·t"이면
 * 항상 배정이 있다: 친구 ↔ 자리(서포터 자리 s개, 딜러 자리 d개) 이분 다중 그래프의 최대 차수가 P 이하라 König 정리로
 * P색 간선 칠하기가 되고(색 = 공대, 같은 색은 친구도 자리도 겹치지 않는다), 두 색의 교대 경로를 뒤집으면 색마다 간선 수를
 * 1 이내로 고르게 맞출 수 있어 공대마다 ⌊|S|/P⌋ ≥ t명이 된다. 그래서 ①②는 P마다 최대 흐름(친구 → 역할)으로 최대 편성 수를
 * 구해 고르고, ③은 그 편성 수에서 서포터 수를 최대로 하는 흐름으로 정한다.
 * ④~⑦은 결정적 휴리스틱: 여러 번(고정 시드) 캐릭터 선택 + 간선 칠하기로 초기 배정 → 교환/이동(못 간 캐릭터와의 교환 포함)
 * 국소 개선 → 이웃 배정까지 모아 중복(공대 순서만 다른 것)을 빼고 순위대로 상위 limit개.
 * 숙련도 점수 차는 공대별 (숙련 +1, 반숙 0, 클경 -1) 합의 최대-최소. 외부 자리는 평균/숙련도 계산에서 빠진다.
 *
 * "모두 편성" 대안 (kind 'fullPlacement'): 같은 후보로 기준을 같은 사다리(3/4 → 1/2 → 1)로 낮춰 가며 편성 수가 가장 큰
 * 기준(같으면 더 높은 기준)을 고르고, 그 기준에서 같은 ①~⑦로 1순위 하나를 구한다. 추천의 1순위보다 편성 수가 많을 때만
 * 결과의 맨 끝에 붙이고 limit 자리 하나를 쓴다 (limit 1이면 붙이지 않는다).
 */

/** 권장 최소 전투력의 이 비율 이상이면 'tight', 미만이면 'risky'. 조정 가능한 상수. */
export const TIGHT_RATIO = 0.9;

/** 레이드 하나에 돌려주는 추천 수 기본값. */
export const DEFAULT_PLAN_LIMIT = 3;

/** 공대 하나에 필요한 친구 캐릭터 최소 비율 (높은 것부터 시도, 마지막은 1명). */
export const FRIEND_RATIOS = [3 / 4, 1 / 2] as const;

// 정렬에서 "나쁜" 정도. risky > tight > unknown > comfortable
const TIER_BADNESS: Record<Tier, number> = { comfortable: 0, unknown: 1, tight: 2, risky: 3 };

const NO_ELIGIBLE_REASON = '참석할 수 있는 캐릭터가 없어요';
const NO_LAYOUT_REASON = '공대를 짤 수 없어요. 클리어 표시나 참석자를 바꿔 보세요.';

/**
 * 탐색량: 초기 배정 횟수, 국소 개선 반복 상한, 이웃 배정 수 상한, 개선이 막혔을 때 시도하는 점수 그대로인 조작 수 상한.
 * 캐릭터 수 n이 크면 조작 하나를 평가하는 값이 커지므로 재시작/시도 수를 줄인다.
 */
const restartsFor = (n: number) => Math.max(6, Math.min(16, Math.floor(600 / n)));
const kickLimitFor = (n: number) => Math.max(32, Math.min(200, Math.floor(6000 / n)));
const MAX_PASSES = 40;
const NEIGHBOR_BUDGET = 4_000;
const EPS = 1e-9;

export function tierFor(avg: number | null, raid: RaidConfig): Tier {
  if (avg === null) return 'unknown';
  if (avg >= raid.recommendedCP.min) return 'comfortable';
  if (avg >= raid.recommendedCP.min * TIGHT_RATIO) return 'tight';
  return 'risky';
}

/** 공대 하나에 필요한 친구 캐릭터 수 후보 (높은 것부터): 4인 [3, 2, 1], 8인 [6, 4, 1]. */
export const friendThresholds = (size: number): number[] =>
  [...new Set([...FRIEND_RATIOS.map((r) => Math.ceil(size * r)), 1])];

/** dev = 숙련 +1, 반숙 0, 클경 -1 (반숙 기준 차이). */
interface Item {
  friendId: string; friend: number; character: Character; support: boolean; cp: number | null;
  level: Proficiency; dev: number;
}
const DEV: Record<Proficiency, number> = { 숙련: 1, 반숙: 0, 클경: -1 };

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

function shuffled<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- ①②③: 편성 수 · 공대 수 · 서포터 수 (최대 흐름) ----------

/** 친구별 후보 수: 서포터 sup[f], 딜러 deal[f]. */
interface Counts { sup: number[]; deal: number[]; }

/**
 * 친구마다 최대 P개, 서포터 합 ≤ supCap, 딜러 합 ≤ dealCap일 때 고를 수 있는 캐릭터 수의 최댓값.
 * 흐름 그래프(출발 → 친구(용량 min(P, 후보 수)) → 서포터/딜러 → 도착(supCap/dealCap))의 최소 절단 4가지 중 최솟값.
 */
function maxPlaced(c: Counts, P: number, supCap: number, dealCap: number): number {
  let all = 0;
  let viaDeal = 0;
  let viaSup = 0;
  for (let f = 0; f < c.sup.length; f++) {
    const cap = Math.min(P, c.sup[f] + c.deal[f]);
    all += cap;
    viaDeal += Math.min(cap, c.deal[f]);
    viaSup += Math.min(cap, c.sup[f]);
  }
  return Math.min(all, supCap + viaDeal, dealCap + viaSup, supCap + dealCap);
}

interface Target { t: number; P: number; N: number; supports: number; }

/** 공대 하나라도 t명 이상으로 만들 수 있는 기준들 (높은 것부터). 첫 번째가 추천의 기준 t. */
function feasibleThresholds(c: Counts, size: number): number[] {
  const s = size / 4;
  // 공대 P개 평균이 t 이상이면 그중 하나는 t 이상이므로 P=1만 보면 된다
  const single = maxPlaced(c, 1, s, size - s);
  return friendThresholds(size).filter((x) => single >= x);
}

/** 기준 t(추천에 쓰는 가장 높은 기준), 공대 수 P, 편성 수 N, 편성할 서포터 수를 정한다 (①②③ 최적). */
function chooseTarget(c: Counts, size: number): Target | null {
  const t = feasibleThresholds(c, size)[0];
  return t === undefined ? null : targetAt(c, size, t);
}

/**
 * "모두 편성" 대안의 목표: 가능한 기준(높은 것부터) 중 편성 수 N이 가장 큰 것, 같으면 더 높은 기준(외부 인원이 적다).
 * 그 기준 안에서는 추천과 같은 ①②③ (targetAt). 기준이 낮을수록 N은 줄지 않으므로 마지막 기준(1)의 N이 최댓값이다.
 */
function chooseFullTarget(c: Counts, size: number): Target | null {
  let best: Target | null = null;
  for (const t of feasibleThresholds(c, size)) {
    const x = targetAt(c, size, t);
    if (x && (!best || x.N > best.N)) best = x;
  }
  return best;
}

/** 기준 t를 정했을 때의 공대 수 P, 편성 수 N, 서포터 수 (①②③ 최적). */
function targetAt(c: Counts, size: number, t: number): Target | null {
  const s = size / 4;
  const d = size - s;
  const n = c.sup.reduce((x, y) => x + y, 0) + c.deal.reduce((x, y) => x + y, 0);
  if (n === 0) return null;
  let best: Target | null = null;
  for (let P = 1; P * t <= n; P++) {
    const N = maxPlaced(c, P, P * s, P * d);
    if (N >= P * t && (!best || N > best.N)) best = { t, P, N, supports: 0 };
  }
  if (!best) return null;
  const totalSup = c.sup.reduce((x, y) => x + y, 0);
  for (let sup = Math.min(best.P * s, totalSup, best.N); sup >= 0; sup--) {
    const deal = best.N - sup;
    if (deal > best.P * d) break;
    if (maxPlaced(c, best.P, sup, deal) === best.N) return { ...best, supports: sup };
  }
  return null; // 도달하지 않는다: N은 어떤 서포터 수로든 이루어진다
}

/**
 * 친구별 (서포터 수, 딜러 수) 배분: 친구마다 ≤ P, 서포터 합 = sup, 딜러 합 = deal. 작은 최대 흐름(증가 경로)으로 구한다.
 * order는 친구를 살펴보는 순서 (재시작마다 다른 배분을 얻기 위해).
 */
function distribute(c: Counts, P: number, sup: number, deal: number, order: number[]): { s: number[]; d: number[] } | null {
  const F = c.sup.length;
  const fs = new Array<number>(F).fill(0);
  const fd = new Array<number>(F).fill(0);
  let gotS = 0;
  let gotD = 0;
  // 증가 경로: 출발 → 친구 f(남은 용량) → 역할 r(f의 남은 후보) → 도착(역할의 남은 용량),
  // 또는 친구 f → 역할 r → (역할 r을 가진 다른 친구 g를 다른 역할로 돌리기) → 도착.
  const room = (f: number) => Math.min(P, c.sup[f] + c.deal[f]) - fs[f] - fd[f];
  const tryAugment = (): boolean => {
    for (const f of order) {
      if (room(f) <= 0) continue;
      // 직접
      if (gotS < sup && fs[f] < c.sup[f]) { fs[f]++; gotS++; return true; }
      if (gotD < deal && fd[f] < c.deal[f]) { fd[f]++; gotD++; return true; }
    }
    // 한 번 돌리기: f가 역할 X를 하나 더 갖고, 다른 친구 g가 X 하나를 Y로 바꾼다 (Y의 도착 용량이 남아 있을 때)
    for (const f of order) {
      if (room(f) <= 0) continue;
      for (const g of order) {
        if (g === f) continue;
        if (gotD < deal && fs[f] < c.sup[f] && fs[g] > 0 && fd[g] < c.deal[g]) { fs[f]++; fs[g]--; fd[g]++; gotD++; return true; }
        if (gotS < sup && fd[f] < c.deal[f] && fd[g] > 0 && fs[g] < c.sup[g]) { fd[f]++; fd[g]--; fs[g]++; gotS++; return true; }
      }
    }
    return false;
  };
  while ((gotS < sup || gotD < deal) && tryAugment()) { /* 반복 */ }
  if (gotS === sup && gotD === deal) return { s: fs, d: fd };
  return exactDistribute(c, P, sup, deal, order);
}

/** 짧은 증가 경로로 못 채웠을 때의 일반 최대 흐름 (Edmonds–Karp, 정점 F+4개). */
function exactDistribute(c: Counts, P: number, sup: number, deal: number, order: number[]): { s: number[]; d: number[] } | null {
  const F = c.sup.length;
  const SRC = F;
  const SUP = F + 1;
  const DEAL = F + 2;
  const SINK = F + 3;
  const V = F + 4;
  const cap = Array.from({ length: V }, () => new Array<number>(V).fill(0));
  for (const f of order) {
    cap[SRC][f] = Math.min(P, c.sup[f] + c.deal[f]);
    cap[f][SUP] = c.sup[f];
    cap[f][DEAL] = c.deal[f];
  }
  cap[SUP][SINK] = sup;
  cap[DEAL][SINK] = deal;
  const flow = Array.from({ length: V }, () => new Array<number>(V).fill(0));
  const nodes = [SRC, ...order, SUP, DEAL, SINK];
  let total = 0;
  for (;;) {
    const prev = new Array<number>(V).fill(-1);
    prev[SRC] = SRC;
    const queue = [SRC];
    while (queue.length && prev[SINK] === -1) {
      const u = queue.shift()!;
      for (const v of nodes) {
        if (prev[v] === -1 && cap[u][v] - flow[u][v] > 0) { prev[v] = u; queue.push(v); }
      }
    }
    if (prev[SINK] === -1) break;
    let aug = Infinity;
    for (let v = SINK; v !== SRC; v = prev[v]) aug = Math.min(aug, cap[prev[v]][v] - flow[prev[v]][v]);
    for (let v = SINK; v !== SRC; v = prev[v]) { flow[prev[v]][v] += aug; flow[v][prev[v]] -= aug; }
    total += aug;
  }
  if (total !== sup + deal) return null;
  return { s: Array.from({ length: F }, (_, f) => flow[f][SUP]), d: Array.from({ length: F }, (_, f) => flow[f][DEAL]) };
}

// ---------- 배정 상태 ----------

/**
 * 점수(④ 이후 + 동률 깨기): 외부 서포터 수(③, 허용된 조작에서는 바뀌지 않는다) → 최악 단계 → 그 단계인 공대 수 →
 * 숙련자 없는 공대 수 → 클경 2명 이상 공대 수 → 숙련도 점수 차 → imbalance → 평균 분산(동률 깨기). 작을수록 좋다.
 */
interface Score {
  extSup: number; worst: number; worstCount: number; noExpert: number; multiNovice: number; profRange: number;
  imbalance: number; spread: number;
}
/** 분산(동률 깨기)을 뺀 비교. 점수 그대로인 조작 뒤의 개선은 이 기준으로 좋아질 때만 받아들인다. */
const compareMain = (a: Score, b: Score) =>
  a.extSup - b.extSup || a.worst - b.worst || a.worstCount - b.worstCount
  || a.noExpert - b.noExpert || a.multiNovice - b.multiNovice || a.profRange - b.profRange
  || (Math.abs(a.imbalance - b.imbalance) > EPS ? a.imbalance - b.imbalance : 0);
const compareScore = (a: Score, b: Score) =>
  compareMain(a, b) || (Math.abs(a.spread - b.spread) > EPS ? a.spread - b.spread : 0);

interface Ctx {
  raid: RaidConfig; items: Item[]; P: number; F: number; t: number; supportSlots: number; dealerSlots: number;
  /** 못 간 캐릭터 자리 (= P). */
  bench: number;
}

/** 배정 상태: item → 공대(0..P-1) 또는 못 감(P). 공대별 친구 유무/역할 수/딜러 전투력 합/숙련도를 같이 들고 다닌다. */
class Layout {
  readonly assign: Int32Array;
  readonly has: Int32Array; // [party * F + friend] 그 공대에 그 친구 캐릭터 수 (0 또는 1; 못 감 자리는 제한 없음)
  readonly sup: Int32Array;
  readonly deal: Int32Array;
  readonly size: Int32Array;
  readonly cpSum: Float64Array;
  readonly cpN: Int32Array;
  readonly expert: Int32Array;
  readonly novice: Int32Array;
  readonly dev: Int32Array;
  constructor(readonly ctx: Ctx) {
    const { items, P, F } = ctx;
    const G = P + 1;
    this.assign = new Int32Array(items.length).fill(-1);
    this.has = new Int32Array(G * F);
    this.sup = new Int32Array(G);
    this.deal = new Int32Array(G);
    this.size = new Int32Array(G);
    this.cpSum = new Float64Array(G);
    this.cpN = new Int32Array(G);
    this.expert = new Int32Array(G);
    this.novice = new Int32Array(G);
    this.dev = new Int32Array(G);
  }
  canPlace(i: number, p: number): boolean {
    if (p === this.ctx.bench) return true;
    const it = this.ctx.items[i];
    if (this.has[p * this.ctx.F + it.friend]) return false;
    return it.support ? this.sup[p] < this.ctx.supportSlots : this.deal[p] < this.ctx.dealerSlots;
  }
  place(i: number, p: number) {
    const it = this.ctx.items[i];
    this.assign[i] = p;
    this.has[p * this.ctx.F + it.friend]++;
    this.size[p]++;
    if (it.dev > 0) this.expert[p]++; else if (it.dev < 0) this.novice[p]++;
    this.dev[p] += it.dev;
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
    if (it.dev > 0) this.expert[p]--; else if (it.dev < 0) this.novice[p]--;
    this.dev[p] -= it.dev;
    if (it.support) this.sup[p]--;
    else {
      this.deal[p]--;
      if (it.cp !== null) { this.cpSum[p] -= it.cp; this.cpN[p]--; }
    }
  }
  score(): Score {
    const { P, raid, supportSlots } = this.ctx;
    let extSup = 0;
    let worst = 0;
    let worstCount = 0;
    let max = -Infinity;
    let min = Infinity;
    let sum = 0;
    let n = 0;
    let sq = 0;
    let noExpert = 0;
    let multiNovice = 0;
    let devMax = -Infinity;
    let devMin = Infinity;
    for (let p = 0; p < P; p++) {
      extSup += supportSlots - this.sup[p];
      if (this.expert[p] === 0) noExpert++;
      if (this.novice[p] >= 2) multiNovice++;
      if (this.dev[p] > devMax) devMax = this.dev[p];
      if (this.dev[p] < devMin) devMin = this.dev[p];
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
    return {
      extSup, worst, worstCount, noExpert, multiNovice, profRange: P ? devMax - devMin : 0,
      imbalance: n ? max - min : 0, spread: n ? sq / n - (sum / n) ** 2 : 0,
    };
  }
  clone(): Layout {
    const l = new Layout(this.ctx);
    l.assign.set(this.assign); l.has.set(this.has); l.sup.set(this.sup); l.deal.set(this.deal);
    l.size.set(this.size); l.cpSum.set(this.cpSum); l.cpN.set(this.cpN);
    l.expert.set(this.expert); l.novice.set(this.novice); l.dev.set(this.dev);
    return l;
  }
  private groups(filter: (it: Item) => boolean): string {
    const groups: string[][] = Array.from({ length: this.ctx.P }, () => []);
    this.ctx.items.forEach((it, i) => { if (this.assign[i] < this.ctx.P && filter(it)) groups[this.assign[i]].push(it.character.name); });
    return groups.map((g) => g.sort().join('\u0001')).sort().join('\u0002');
  }
  /** 공대 순서를 무시한 배정 키 (편성된 캐릭터가 같으면 못 간 캐릭터도 같다). */
  key(): string { return this.groups(() => true); }
  /** 딜러 배치만의 키 (서포터 자리만 바꾼 추천과 구별). */
  dealerKey(): string { return this.groups((it) => !it.support); }
}

// ---------- 초기 배정: 캐릭터 고르기 + 간선 칠하기 ----------

/**
 * 고른 캐릭터들을 공대 P개에 나눈다. 친구 ↔ 자리 이분 다중 그래프의 P색 간선 칠하기(교대 경로 뒤집기)를 한 뒤,
 * 가장 큰 색과 가장 작은 색의 교대 경로를 뒤집어 공대 크기 차이를 1 이내로 맞춘다. 실패하면(도달하지 않음) null.
 */
function colorLayout(ctx: Ctx, selected: number[], rand: () => number, shuffle: boolean): Layout | null {
  const { items, P, F, supportSlots, dealerSlots, t } = ctx;
  const V = F + supportSlots + dealerSlots;
  const E = selected.length;
  const eu = new Int32Array(E);
  const ev = new Int32Array(E);
  // 자리 나누기: 서포터는 서포터 자리에, 딜러는 (전투력 순서로) 딜러 자리에 돌아가며. 자리마다 최대 P개.
  const sups = selected.filter((i) => items[i].support);
  const deals = selected.filter((i) => !items[i].support).sort((a, b) => (items[b].cp ?? -1) - (items[a].cp ?? -1) || a - b);
  const order = [...sups, ...deals];
  order.forEach((i, e) => {
    eu[e] = items[i].friend;
    const k = e < sups.length ? e % supportSlots : supportSlots + ((e - sups.length) % dealerSlots);
    ev[e] = F + k;
  });
  const at = new Int32Array(V * P).fill(-1);
  const color = new Int32Array(E).fill(-1);
  const other = (e: number, x: number) => (eu[e] === x ? ev[e] : eu[e]);
  const setColor = (e: number, c: number) => { color[e] = c; at[eu[e] * P + c] = e; at[ev[e] * P + c] = e; };
  const clearColor = (e: number) => { at[eu[e] * P + color[e]] = -1; at[ev[e] * P + color[e]] = -1; color[e] = -1; };
  const freeAt = (x: number) => { for (let c = 0; c < P; c++) if (at[x * P + c] === -1) return c; return -1; };
  const path = (start: number, c1: number, c2: number): number[] => {
    const out: number[] = [];
    let x = start;
    let c = c1;
    for (;;) {
      const e = at[x * P + c];
      if (e === -1) return out;
      out.push(e);
      x = other(e, x);
      c = c === c1 ? c2 : c1;
    }
  };
  const flip = (es: number[], c1: number, c2: number) => {
    const cs = es.map((e) => color[e]);
    es.forEach(clearColor);
    es.forEach((e, k) => setColor(e, cs[k] === c1 ? c2 : c1));
  };
  const edgeOrder = Array.from({ length: E }, (_, e) => e);
  for (const e of shuffle ? shuffled(edgeOrder, rand) : edgeOrder) {
    const u = eu[e];
    const v = ev[e];
    const a = freeAt(u);
    const b = freeAt(v);
    if (a === -1 || b === -1) return null;
    if (at[v * P + a] !== -1) flip(path(v, a, b), a, b); // 이분 그래프라 이 경로는 u에 닿지 않는다
    setColor(e, a);
  }
  // 색(공대)마다 크기를 고르게
  const sizes = () => { const s = new Array<number>(P).fill(0); for (let e = 0; e < E; e++) s[color[e]]++; return s; };
  for (let guard = 0; guard < E * P + 10; guard++) {
    const s = sizes();
    let hi = 0;
    let lo = 0;
    for (let c = 1; c < P; c++) { if (s[c] > s[hi]) hi = c; if (s[c] < s[lo]) lo = c; }
    if (s[hi] - s[lo] <= 1) break;
    let done = false;
    for (let x = 0; x < V && !done; x++) {
      if (at[x * P + hi] === -1 || at[x * P + lo] !== -1) continue;
      const es = path(x, hi, lo);
      if (es.length % 2 === 1) { flip(es, hi, lo); done = true; }
    }
    if (!done) return null;
  }
  const L = new Layout(ctx);
  order.forEach((i, e) => L.place(i, color[e]));
  const picked = new Set(selected);
  items.forEach((_, i) => { if (!picked.has(i)) L.place(i, ctx.bench); });
  for (let p = 0; p < P; p++) if (L.size[p] < t) return null;
  return L;
}

/** 친구별 배분대로 캐릭터를 고른다. 첫 시도는 전투력 높은 딜러 / 숙련도 높은 서포터부터, 나머지는 무작위. */
function selectItems(ctx: Ctx, byFriend: number[][], dist: { s: number[]; d: number[] }, rand: () => number, greedy: boolean): number[] {
  const { items } = ctx;
  const out: number[] = [];
  byFriend.forEach((idx, f) => {
    const pick = (list: number[], k: number, key: (i: number) => number) => {
      const sorted = greedy ? [...list].sort((a, b) => key(b) - key(a) || a - b) : shuffled(list, rand);
      out.push(...sorted.slice(0, k));
    };
    pick(idx.filter((i) => items[i].support), dist.s[f], (i) => items[i].dev);
    pick(idx.filter((i) => !items[i].support), dist.d[f], (i) => items[i].cp ?? -1);
  });
  return out;
}

// ---------- 국소 개선 ----------

/**
 * 서로 다른 자리(공대 또는 못 감)의 두 캐릭터 교환이 규칙을 지키는지. 공대끼리는 역할이 달라도 된다
 * (교환 뒤 두 공대 모두 역할 자리 수를 넘지 않고 같은 친구가 겹치지 않으면 된다). 못 간 캐릭터와의 교환은 같은 역할끼리만
 * (편성 서포터 수 = ③을 지키기 위해).
 */
function canSwap(L: Layout, i: number, j: number): boolean {
  const { items, F, supportSlots, dealerSlots, bench } = L.ctx;
  const pa = L.assign[i];
  const pb = L.assign[j];
  if (pa === pb) return false;
  const a = items[i];
  const b = items[j];
  if (a.support !== b.support) {
    if (pa === bench || pb === bench) return false;
    const into = (p: number, inSup: boolean) =>
      inSup ? L.sup[p] + 1 <= supportSlots : L.deal[p] + 1 <= dealerSlots;
    if (!into(pa, b.support) || !into(pb, a.support)) return false;
  }
  if (a.friend === b.friend) return true;
  return (pb === bench || !L.has[pb * F + a.friend]) && (pa === bench || !L.has[pa * F + b.friend]);
}

function swap(L: Layout, i: number, j: number) {
  const pa = L.assign[i];
  const pb = L.assign[j];
  L.remove(i); L.remove(j);
  L.place(i, pb); L.place(j, pa);
}

/** 이동: 공대 사이에서만 (편성 수가 그대로), 떠나는 공대가 기준 t 아래로 내려가지 않게. */
function canMove(L: Layout, i: number, q: number): boolean {
  const from = L.assign[i];
  const { bench, t } = L.ctx;
  return from !== q && from !== bench && q !== bench && L.size[from] > t && L.canPlace(i, q);
}

function move(L: Layout, i: number, q: number) {
  L.remove(i);
  L.place(i, q);
}

/** 점수가 바뀌지 않는 교환인지 (전투력·역할·숙련도가 같은 캐릭터끼리). 일반 탐색에서는 건너뛴다. */
const neutral = (items: Item[], i: number, j: number) =>
  items[i].cp === items[j].cp && items[i].support === items[j].support && items[i].dev === items[j].dev;
/** 점수가 바뀌지 않는 이동인지 (전투력이 없고 반숙인 캐릭터: 서포터, 전투력 모르는 딜러). */
const neutralMove = (it: Item) => it.cp === null && it.dev === 0;

/**
 * 자리 touched(1~2개)에 걸친 교환/이동 중 점수가 (분산 말고) 좋아지는 첫 조작을 적용한다. 적용했으면 새 점수, 없으면 null.
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
    if (neutralMove(items[i])) continue;
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
 * 국소 개선: 교환(못 간 캐릭터와의 교환 포함)/이동으로 점수가 좋아지는 동안 반복한다. 더 좋아지지 않으면 점수 그대로인
 * 조작을 하나 해 보고 그 덕에 생긴 개선이 있을 때만 받아들인다(최대 kickLimitFor(n)번 시도). 받아들인 조작은 항상 점수를 낮춘다.
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
      if (neutralMove(items[i])) continue;
      for (let q = 0; q < P; q++) {
        if (!canMove(L, i, q)) continue;
        const from = L.assign[i];
        move(L, i, q);
        const s = L.score();
        if (compareScore(s, cur) < 0) { cur = s; improved = true; } else move(L, i, from);
      }
    }
    if (improved) continue;
    let kicks = 0;
    let kicked = false;
    outer: for (let i = 0; i < n && kicks < kickLimit; i++) {
      if (neutralMove(items[i])) {
        for (let q = 0; q < P && kicks < kickLimit; q++) {
          if (!canMove(L, i, q)) continue;
          kicks++;
          const from = L.assign[i];
          move(L, i, q);
          const s = improveAround(L, [from, q], cur);
          if (s) { cur = s; kicked = true; break outer; }
          move(L, i, from);
        }
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

/** 정해진 (t, P, N, 서포터 수)로 여러 배정을 찾는다. */
function search(ctx: Ctx, counts: Counts, target: Target, byFriend: number[][]): Found[] {
  const found = new Map<string, Found>();
  const add = (L: Layout, score: Score) => {
    const key = L.key();
    if (!found.has(key)) found.set(key, { layout: L.clone(), score, key });
  };
  const { items, P, F } = ctx;
  const rand = rng(0x5eed + items.length * 31 + P);
  const restarts = restartsFor(items.length);
  const identity = Array.from({ length: F }, (_, f) => f);
  for (let r = 0; r < restarts; r++) {
    const order = r === 0 ? identity : shuffled(identity, rand);
    const dist = distribute(counts, P, target.supports, target.N - target.supports, order);
    if (!dist) continue;
    const selected = selectItems(ctx, byFriend, dist, rand, r === 0);
    const L = colorLayout(ctx, selected, rand, r > 0);
    if (!L) continue;
    add(L, L.score());
    add(L, improve(L));
  }
  if (found.size === 0) return [];

  // 이웃 배정: 가장 좋은 몇 개에서 한 번 교환/이동한 배정도 후보로 (서로 다른 추천을 넉넉히 만들기 위해)
  const seeds = [...found.values()].sort((a, b) => compareScore(a.score, b.score) || (a.key < b.key ? -1 : 1)).slice(0, 3);
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
function toCandidate(f: Found, kind: CandidateKind = 'recommended'): Candidate {
  const L = f.layout;
  const { items, P, raid, supportSlots, t, bench } = L.ctx;
  const parties: (Party & { key: string; friends: number })[] = [];
  for (let p = 0; p < P; p++) {
    const members = items.map((it, i) => ({ it, i })).filter(({ i }) => L.assign[i] === p);
    const sups = members.filter(({ it }) => it.support).length;
    const extSupports = supportSlots - sups;
    const extDealers = raid.size - members.length - extSupports;
    const slots: Slot[] = [
      ...members.map(({ it }): Slot => ({ kind: 'friend', friendId: it.friendId, character: it.character, proficiency: it.level })),
      ...Array.from({ length: extSupports }, (): Slot => ({ kind: 'external', role: 'support' })),
      ...Array.from({ length: extDealers }, (): Slot => ({ kind: 'external', role: 'dealer' })),
    ];
    // 증감으로 쌓인 합 대신 구성원으로 다시 계산 (소수 전투력의 오차 방지)
    const cps = members.flatMap(({ it }) => (it.cp === null ? [] : [it.cp]));
    const dealerAvgCP = cps.length ? cps.reduce((x, y) => x + y, 0) / cps.length : null;
    parties.push({
      slots, dealerAvgCP, tier: tierFor(dealerAvgCP, raid), proficiency: summarizeProficiency(slots),
      key: members.map(({ it }) => it.character.name).sort().join('\u0001'), friends: members.length,
    });
  }
  parties.sort((a, b) => b.friends - a.friends || (b.dealerAvgCP ?? -Infinity) - (a.dealerAvgCP ?? -Infinity) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const clean: Party[] = parties.map(({ slots, dealerAvgCP, tier, proficiency }) => ({ slots, dealerAvgCP, tier, proficiency }));
  const avgs = clean.flatMap((p) => (p.dealerAvgCP === null ? [] : [p.dealerAvgCP]));
  const imbalance = avgs.length ? Math.max(...avgs) - Math.min(...avgs) : 0;
  const unplaced: UnplacedCharacter[] = items.flatMap((it, i) =>
    (L.assign[i] === bench ? [{ friendId: it.friendId, characterName: it.character.name }] : []));
  return { kind, parties: clean, summary: summarize(clean, t), imbalance, unplaced };
}

/** 공대 목록의 요약. friendThreshold는 그 추천에 쓴 친구 최소 인원 t. */
export function summarize(parties: Party[], friendThreshold: number): PlanSummary {
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
    externalCount: externalSupports + externalDealers, externalSupports, externalDealers, friendThreshold,
  };
}

export function planRaid(input: {
  raid: RaidConfig;
  friends: Friend[];
  clears: ClearRecord[];
  attendeeIds: string[];
  limit?: number;
  /**
   * 이 레이드(이름)에서 직접 정한 캐릭터의 숙련도, 정하지 않았으면 undefined (반숙으로 계산).
   * 주지 않으면 모두 반숙 (숙련도가 순위에 영향 없음). 하나라도 정해 두었으면 결과의 proficiencyTracked가 true.
   */
  proficiency?: (friendId: string, characterName: string) => Proficiency | undefined;
  /**
   * 이 레이드(이름)에서 직접 정한 캐릭터의 가는 난이도(난이도 이름 또는 `안 감`), 정하지 않았으면 undefined (자동 기본값).
   * 주지 않아도 자동 기본값(입장 가능한 가장 높은 난이도)으로 거른다.
   */
  targetDifficulty?: (friendId: string, characterName: string) => string | undefined;
}): PlanResult {
  const { raid, friends, clears, attendeeIds, limit = DEFAULT_PLAN_LIMIT, proficiency, targetDifficulty } = input;
  const excluded: PlanResult['excluded'] = [];
  const attendees = new Set(attendeeIds);
  const items: Item[] = [];
  const byFriend: number[][] = [];
  // 방어: 두 친구에 같은 이름의 캐릭터가 있으면 먼저 나온 친구의 것만 쓴다 (한 추천에 같은 캐릭터가 두 번 놓이지 않게).
  const claimed = new Set<string>();
  let proficiencyTracked = false;
  for (const f of friends) {
    if (!attendees.has(f.id)) continue;
    const eligible = eligibleCharacters(f, raid, clears, (name) => targetDifficulty?.(f.id, name)).filter((c) => !claimed.has(c.name));
    for (const c of eligible) claimed.add(c.name);
    if (eligible.length === 0) { excluded.push({ friendId: f.id, reason: '가능한 캐릭터 없음' }); continue; }
    const friend = byFriend.length;
    const mine: number[] = [];
    for (const c of eligible) {
      const recorded = proficiency?.(f.id, c.name);
      if (recorded !== undefined) proficiencyTracked = true;
      const level = recorded ?? DEFAULT_PROFICIENCY;
      mine.push(items.length);
      items.push({
        friendId: f.id, friend, character: c, support: c.role === 'support', cp: c.role === 'support' ? null : c.combatPower,
        level, dev: DEV[level],
      });
    }
    byFriend.push(mine);
  }
  if (items.length === 0) {
    return excluded.length ? { candidates: [], excluded, reason: NO_ELIGIBLE_REASON } : { candidates: [], excluded };
  }

  const supportSlots = raid.size / 4;
  const dealerSlots = raid.size - supportSlots;
  const counts: Counts = {
    sup: byFriend.map((idx) => idx.filter((i) => items[i].support).length),
    deal: byFriend.map((idx) => idx.filter((i) => !items[i].support).length),
  };
  const target = chooseTarget(counts, raid.size);
  if (!target) return { candidates: [], excluded, reason: NO_LAYOUT_REASON, proficiencyTracked };
  const rankedAt = (tg: Target): Found[] => {
    const ctx: Ctx = { raid, items, P: tg.P, F: byFriend.length, t: tg.t, supportSlots, dealerSlots, bench: tg.P };
    return search(ctx, counts, tg, byFriend)
      .sort((a, b) => compareScore(a.score, b.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  };
  const ranked = rankedAt(target);
  if (ranked.length === 0) return { candidates: [], excluded, reason: NO_LAYOUT_REASON, proficiencyTracked };

  // "모두 편성" 대안: 기준을 낮춰 추천보다 캐릭터를 더 많이 편성할 수 있을 때만, 자리(limit) 하나를 써서 맨 끝에 하나.
  // 추천의 편성 수 N은 모든 추천이 같으므로 대안은 어떤 추천과도 같은 편성이 아니다.
  let full: Found | undefined;
  if (limit >= 2) {
    const fullTarget = chooseFullTarget(counts, raid.size);
    if (fullTarget && fullTarget.N > target.N) full = rankedAt(fullTarget)[0];
  }
  const recLimit = full ? limit - 1 : limit;

  // 딜러 배치가 다른 추천을 먼저 고르고(서포터 자리만 바꾼 비슷한 추천이 위를 다 차지하지 않게), 남은 자리는 순위대로.
  const chosen = new Set<Found>();
  const dealerKeys = new Set<string>();
  for (const f of ranked) {
    if (chosen.size >= recLimit) break;
    const dk = f.layout.dealerKey();
    if (!dealerKeys.has(dk)) { dealerKeys.add(dk); chosen.add(f); }
  }
  for (const f of ranked) {
    if (chosen.size >= recLimit) break;
    chosen.add(f);
  }
  const candidates = ranked.filter((f) => chosen.has(f)).map((f) => toCandidate(f));
  if (full && candidates.length) {
    const alt = toCandidate(full, 'fullPlacement');
    const best = candidates[0].summary;
    alt.summary.extraExternalVsBest = alt.summary.externalCount - best.externalCount;
    alt.summary.extraPlacedVsBest = alt.summary.characterCount - best.characterCount;
    candidates.push(alt);
  }
  return { candidates, excluded, proficiencyTracked };
}
