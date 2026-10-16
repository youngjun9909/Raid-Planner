/**
 * 디스코드 메시지 만들기 (순수 함수). 모든 결과는 디스코드 제한(LIMITS) 안으로 맞춘다.
 * 아이콘/색은 theme.ts에서만 가져온다.
 */
import { RAIDS } from '@/core/raids';
import { weekKey } from '@/core/week';
import type { Candidate, Character, ClearRecord, Friend, Party, PlanResult, Proficiency, RaidConfig, Slot, Tier, UnplacedCharacter } from '@/core/types';
import { DEFAULT_PROFICIENCY, NO_EXPERT_TEXT, partyProficiency, proficiencySummaryText, showProficiencyBadge } from '@/core/proficiency';
import { visibleFriend } from '@/core/visible';
import { countExternals, formatCP, formatLevel, formatRange, planSummaryText } from '@/lib/view-model';
import { arrangeParty } from '@/lib/arrange-party';
import { COMMAND_GROUPS, raidTitle, type CommandDef } from './commands';
import { BOT_NAME, COLOR, GAUGE, ICON, PROFICIENCY_TEXT, TIER_BADNESS, TIER_COLOR, TIER_TEXT } from './theme';
import type { ActionRow, Embed, EmbedField } from './types';

export { raidTitle, TIER_TEXT, TIER_COLOR };

/** 디스코드 메시지/임베드 제한. */
export const LIMITS = {
  content: 2000,
  author: 256,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  embedTotal: 6000, // 한 메시지의 모든 임베드 합계
  embeds: 10,
} as const;
export const MAX_CONTENT = LIMITS.content;

/** 메시지 한 개 분량: 알림 미리보기용 짧은 content + 임베드 (+ 버튼). */
export interface MessageParts { content: string; embeds: Embed[]; components?: ActionRow[]; }

const ELLIPSIS = '…';
const TRIM_NOTE = '… (길어서 일부 생략했어요)';
const SPACER: EmbedField = { name: '​', value: '​' };

// ---------- 길이 맞추기 ----------

/** 글자 단위로 자르되 서로게이트 쌍(이모지)은 깨지 않는다. 잘리면 끝에 "…". */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const chr of Array.from(text)) {
    if (out.length + chr.length > max - ELLIPSIS.length) break;
    out += chr;
  }
  return out + ELLIPSIS;
}

/** 줄 단위로 자르고(줄 중간은 자르지 않음) 마지막에 안내 줄을 붙인다. 첫 줄부터 넘치면 글자 단위로 자른다. */
export function clipLines(text: string, max: number, note = ELLIPSIS): string {
  if (text.length <= max) return text;
  const budget = max - note.length - 1;
  const kept: string[] = [];
  let used = 0;
  for (const line of text.split('\n')) {
    const cost = line.length + (kept.length ? 1 : 0);
    if (used + cost > budget) break;
    kept.push(line);
    used += cost;
  }
  if (kept.length === 0) return clipText(text.split('\n')[0], max);
  return `${kept.join('\n')}\n${note}`;
}

/** 2000자를 넘는 content를 줄 단위로 잘라 생략 안내를 붙인다. */
export function fitMessage(text: string, max: number = LIMITS.content): string {
  return clipLines(text, max, TRIM_NOTE);
}

export function embedSize(e: Embed): number {
  return (e.author?.name.length ?? 0) + (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0)
    + (e.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
}

/** 임베드 하나를 디스코드 제한 안으로 맞춘다 (빈 필드 이름/값도 막는다). */
export function sanitizeEmbed(e: Embed, maxTotal: number = LIMITS.embedTotal): Embed {
  const out: Embed = {};
  if (e.author?.name) out.author = { name: clipText(e.author.name, LIMITS.author) };
  if (e.title) out.title = clipText(e.title, LIMITS.title);
  if (e.description) out.description = clipLines(e.description, LIMITS.description);
  if (e.color !== undefined) out.color = e.color;
  if (e.fields?.length) {
    out.fields = e.fields.slice(0, LIMITS.fields).map((f) => ({
      name: clipText(f.name || '-', LIMITS.fieldName),
      value: clipLines(f.value || '-', LIMITS.fieldValue),
      ...(f.inline ? { inline: true } : {}),
    }));
  }
  if (e.footer?.text) out.footer = { text: clipLines(e.footer.text, LIMITS.footer) };
  if (e.timestamp) out.timestamp = e.timestamp;
  // 합계가 넘치면: 뒤쪽 필드를 하나만 남을 때까지 빼고 → 설명을 줄이고 → 꼬리말·작성자 → 마지막 필드 → 제목 순으로 줄인다.
  const over = () => embedSize(out) > maxTotal;
  const dropTrailingSpacers = () => {
    while (out.fields?.length && out.fields[out.fields.length - 1].name === SPACER.name) out.fields.pop();
  };
  while (over() && (out.fields?.length ?? 0) > 1) { out.fields!.pop(); dropTrailingSpacers(); }
  if (over() && out.description) {
    const room = maxTotal - (embedSize(out) - out.description.length);
    if (room >= 2) out.description = clipLines(out.description, room); else delete out.description;
  }
  if (over()) delete out.footer;
  if (over()) delete out.author;
  if (over()) delete out.fields;
  if (over() && out.title) out.title = clipText(out.title, Math.max(1, maxTotal));
  dropTrailingSpacers();
  if (out.fields?.length === 0) delete out.fields;
  return out;
}

/** 메시지의 임베드 목록을 10개·합계 6000자 안으로 맞춘다 (첫 임베드는 줄여서라도 남기고, 다 들어가지 않는 뒤쪽 임베드는 통째로 뺀다). */
export function fitEmbeds(embeds: Embed[]): Embed[] {
  const out: Embed[] = [];
  let total = 0;
  for (const e of embeds.slice(0, LIMITS.embeds)) {
    const s = sanitizeEmbed(e);
    const size = embedSize(s);
    if (out.length > 0 && total + size > LIMITS.embedTotal) break;
    out.push(s);
    total += size;
  }
  return out;
}

const parts = (content: string, embeds: Embed[], components?: ActionRow[]): MessageParts =>
  ({ content: fitMessage(content), embeds: fitEmbeds(embeds), ...(components ? { components } : {}) });

// ---------- 공통 꾸밈 ----------

export const weekText = (now: Date) => `${ICON.week} 이번 주: ${weekKey(now)} 수요일 06:00 초기화`;

/** 모든 임베드의 공통 틀: 작성자 줄, 주간 꼬리말, 시각. */
function frame(now: Date, section: string, e: Embed, footerPrefix?: string): Embed {
  return {
    author: { name: `${BOT_NAME} · ${section}` },
    ...e,
    footer: { text: footerPrefix ? `${footerPrefix}  ·  ${weekText(now)}` : weekText(now) },
    timestamp: now.toISOString(),
  };
}

/** 평균 전투력 / 권장 최소치 막대. 막대는 0~100%로 자르고 숫자는 실제 비율을 보여 준다. */
export function gauge(avg: number | null, recommendedMin: number): string {
  if (avg === null || !(recommendedMin > 0)) return `${GAUGE.empty.repeat(GAUGE.cells)} 정보 없음`;
  const pct = Math.round((avg / recommendedMin) * 100);
  const filled = Math.min(GAUGE.cells, Math.max(0, Math.round(pct / (100 / GAUGE.cells))));
  return `${GAUGE.full.repeat(filled)}${GAUGE.empty.repeat(GAUGE.cells - filled)} ${pct}%`;
}

// ---------- /공대 ----------

/**
 * 메시지 분량 단계. 0 = 평소(외부인 한 줄씩, 게이지, 공대 사이 빈칸), 1 = 외부인을 역할별 한 줄로,
 * 2 = 게이지와 아이템 레벨도 뺀다. 추천이 다 들어갈 때까지 단계를 올린다.
 */
type Detail = 0 | 1 | 2;

/** tracked: 이 편성에서 숙련도를 직접 정한 캐릭터가 있는가. 아니면 기본(반숙) 배지와 숙련도 요약·경고를 뺀다. */
function memberLine(slot: Slot, names: Map<string, string>, detail: Detail, tracked: boolean): string {
  if (slot.kind === 'external') return `${ICON.external} 외부 ${slot.role === 'support' ? '서포터' : '딜러'} 구하기`;
  const c = slot.character;
  const owner = names.get(slot.friendId) ?? '?';
  const level = detail < 2 ? ` · ${formatLevel(c.itemLevel)}` : '';
  const lv = slot.proficiency ?? DEFAULT_PROFICIENCY;
  const prof = showProficiencyBadge(lv, tracked) ? ` ${PROFICIENCY_TEXT[lv]}` : '';
  return c.role === 'support'
    ? `${ICON.support} **${c.name}**${prof}${level} · ${owner}`
    : `${ICON.dealer} **${c.name}**${prof}${level} · CP ${formatCP(c.combatPower)} · ${owner}`;
}

/**
 * 공대 칸 제목 뒤에 붙는 숙련도: " · 숙련 1 · 반숙 1 · 클경 0" (+ " · ⚠️ 숙련자 없음"). 외부 자리는 세지 않는다.
 * 숙련도를 추적하지 않으면(아무도 정하지 않음) 빈 문자열: 자리를 아끼고 의미 없는 경고를 띄우지 않는다.
 */
function proficiencyTitle(p: Party, tracked: boolean): string {
  if (!tracked) return '';
  const s = partyProficiency(p);
  return ` · ${proficiencySummaryText(s)}${s.noExpert ? ` · ${ICON.warn} ${NO_EXPERT_TEXT}` : ''}`;
}

/** 8인 공대의 두 4인 파티 사이 구분선. */
export const BLOCK_SEPARATOR = '┈┈┈┈┈┈┈┈';

/** 구성원 줄: 4인은 딜러 3 → 서포터 1, 8인은 그 묶음 둘을 구분선으로 나눈다 (arrangeParty 순서). */
function memberLines(p: Party, names: Map<string, string>, detail: Detail, size: number, tracked: boolean): string[] {
  const blocks = arrangeParty(p, size);
  const lines = blocks.map((block) => {
    if (detail === 0) return block.map((s) => memberLine(s, names, detail, tracked));
    // 줄이는 단계: 같은 역할의 외부인 연속 자리는 한 줄로 합친다 (순서는 그대로).
    const out: string[] = [];
    for (let i = 0; i < block.length; i++) {
      const s = block[i];
      if (s.kind === 'friend') { out.push(memberLine(s, names, detail, tracked)); continue; }
      let n = 1;
      while (i + 1 < block.length) {
        const nx = block[i + 1];
        if (nx.kind !== 'external' || nx.role !== s.role) break;
        n++; i++;
      }
      out.push(`${ICON.external} 외부 ${s.role === 'support' ? '서포터' : '딜러'} ${n}명 구하기`);
    }
    return out;
  });
  return lines.flatMap((l, i) => (i > 0 ? [BLOCK_SEPARATOR, ...l] : l));
}

/** 공대 칸: 이름 "1공대 · 평균 3,900 🟢 여유 · 숙련 1 · 반숙 2 · 클경 0", 값은 게이지 + 구성원 줄. */
function partyField(p: Party, i: number, raid: RaidConfig, names: Map<string, string>, detail: Detail, tracked: boolean): EmbedField {
  const avg = p.dealerAvgCP === null ? '정보 없음' : formatCP(p.dealerAvgCP);
  const lines = memberLines(p, names, detail, raid.size, tracked);
  return {
    name: `${i + 1}공대 · 평균 ${avg} ${TIER_TEXT[p.tier]}${proficiencyTitle(p, tracked)}`,
    value: (detail < 2 ? [`\`${gauge(p.dealerAvgCP, raid.recommendedCP.min)}\``, ...lines] : lines).join('\n'),
  };
}

export function externalFooter(parties: Party[]): string {
  const { support, dealer } = parties
    .map((p) => countExternals(p.slots))
    .reduce((a, b) => ({ support: a.support + b.support, dealer: a.dealer + b.dealer }), { support: 0, dealer: 0 });
  const total = support + dealer;
  return total === 0 ? '친구들만으로 구성 가능' : `외부 ${total}명 필요 (서포터 ${support}, 딜러 ${dealer})`;
}

export const worstTier = (parties: Party[]): Tier =>
  parties.reduce<Tier>((w, p) => (TIER_BADNESS[p.tier] > TIER_BADNESS[w] ? p.tier : w), 'comfortable');

function excludedText(result: PlanResult, names: Map<string, string>): string {
  return result.excluded.length
    ? `${ICON.empty} 이번엔 쉬어요: ${result.excluded.map((e) => `${names.get(e.friendId) ?? '?'} (${e.reason})`).join(', ')}`
    : '';
}

/** /공대 메시지의 버튼: 다시 계산, 클리어 표시. custom_id는 100자 이하. */
export function planButtons(raid: RaidConfig): ActionRow {
  return {
    type: 1,
    components: [
      { type: 2, style: 2, label: '다시 계산', emoji: { name: ICON.refresh }, custom_id: `plan:${raid.id}` },
      { type: 2, style: 3, label: '클리어 표시', emoji: { name: ICON.clear }, custom_id: 'clr:start' },
    ],
  };
}

/** "이번에 못 간 캐릭터" 칸 이름과 설명. */
export const UNPLACED_FIELD_NAME = '이번에 못 간 캐릭터';
export const UNPLACED_NOTE = '외부인이 많이 필요해서 이번 추천에서 뺐어요';

/** "모두 편성" 임베드 제목 앞부분. */
export const FULL_PLACEMENT_TITLE = '모두 편성';

/**
 * 못 간 캐릭터 칸의 값: 친구별 한 줄 "<친구> <캐릭터>, <캐릭터>", 길면 들어가는 만큼만 보이고 "외 N개",
 * 마지막 줄은 늘 설명. 전체 길이는 budget(≤1024)을 넘지 않는다. 비어 있으면 null.
 */
export function unplacedFieldValue(unplaced: UnplacedCharacter[], names: Map<string, string>, budget: number = LIMITS.fieldValue): string | null {
  if (unplaced.length === 0) return null;
  const max = Math.min(budget, LIMITS.fieldValue);
  const groups: { friendId: string; chars: string[] }[] = [];
  for (const u of unplaced) {
    const g = groups.find((x) => x.friendId === u.friendId);
    if (g) g.chars.push(u.characterName);
    else groups.push({ friendId: u.friendId, chars: [u.characterName] });
  }
  const tail = (rest: number) => `${rest > 0 ? `외 ${rest}개\n` : ''}${UNPLACED_NOTE}`;
  // 캐릭터를 하나씩 넣어 가며, 그 뒤에 "외 N개"와 설명을 붙여도 max 안인지 매번 확인한다.
  const lines: string[] = [];
  let shown = 0;
  const fits = (candidate: string[], count: number) => `${candidate.join('\n')}\n${tail(unplaced.length - count)}`.length <= max;
  outer: for (const g of groups) {
    const who = clipText(names.get(g.friendId) ?? '알 수 없음', 40);
    let line = '';
    for (const c of g.chars) {
      const next = line ? `${line}, ${clipText(c, 40)}` : `${who} ${clipText(c, 40)}`;
      if (!fits([...lines, next], shown + 1)) {
        if (line) lines.push(line);
        break outer;
      }
      line = next;
      shown++;
    }
    lines.push(line);
  }
  return `${lines.length ? `${lines.join('\n')}\n` : ''}${tail(unplaced.length - shown)}`;
}

interface EmbedOpts { detail: Detail; shown?: number; tracked: boolean; dropUnplaced?: boolean; }

/** 못 간 캐릭터 칸에 줄 수 있는 글자 수 (분량 단계가 높을수록 짧게). */
const UNPLACED_BUDGET: Record<Detail, number> = { 0: 900, 1: 600, 2: 380 };

/**
 * 추천 하나 = 임베드 하나: 제목 "⭐ 추천 1 · 세르카 하드"(추천만 번호를 센다) 또는 "모두 편성 · 세르카 하드",
 * 설명 = (모두 편성이면 비교 줄) + 요약 한 줄, 공대마다 칸 하나, 추천에는 못 간 캐릭터 칸.
 */
function candidateEmbed(c: Candidate, i: number, number: number, raid: RaidConfig, names: Map<string, string>, excluded: string, now: Date, opts: EmbedOpts): Embed {
  const full = c.kind === 'fullPlacement';
  const unplacedValue = full || opts.dropUnplaced ? null : unplacedFieldValue(c.unplaced ?? [], names, UNPLACED_BUDGET[opts.detail]);
  const fieldRoom = LIMITS.fields - (unplacedValue ? 1 : 0);
  const shown = Math.min(opts.shown ?? c.parties.length, c.parties.length);
  const spacers = opts.detail === 0 && shown * 2 - 1 <= fieldRoom;
  const fields: EmbedField[] = [];
  c.parties.slice(0, shown).forEach((p, j) => {
    if (j > 0 && spacers) fields.push(SPACER);
    fields.push(partyField(p, j, raid, names, opts.detail, opts.tracked));
  });
  if (unplacedValue) fields.push({ name: UNPLACED_FIELD_NAME, value: unplacedValue });
  const extra = c.summary.extraExternalVsBest ?? 0;
  const placed = c.summary.extraPlacedVsBest ?? 0;
  const compare = [...(extra > 0 ? [`외부 ${extra}명 더 필요`] : []), ...(placed > 0 ? [`캐릭터 ${placed}개 더 편성`] : [])];
  const description = [
    ...(full && compare.length ? [`추천보다 ${compare.join(' · ')}`] : []),
    planSummaryText(c.summary),
    `권장 전투력 ${formatRange(raid)}`,
    ...(shown < c.parties.length ? [`공대 ${c.parties.length}개 중 ${shown}개만 보여요 (길어서 줄였어요). 전체는 웹 화면에서 볼 수 있어요.`] : []),
    ...(opts.dropUnplaced && (c.unplaced?.length ?? 0) > 0 ? [`이번에 못 간 캐릭터 ${c.unplaced.length}개는 길어서 뺐어요. 웹 화면에서 볼 수 있어요.`] : []),
    ...(i === 0 && excluded ? [excluded] : []),
  ].join('\n');
  return frame(now, `${ICON.party} 공대 추천`, {
    title: full ? `${FULL_PLACEMENT_TITLE} · ${raidTitle(raid)}` : `${number === 1 ? `${ICON.star} ` : ''}추천 ${number} · ${raidTitle(raid)}`,
    color: TIER_COLOR[worstTier(c.parties)],
    description,
    fields,
  }, `${ICON.external} ${externalFooter(c.parties)}`);
}

/** 줄이지 않아도 디스코드 제한 안에 들어가는 임베드인지. */
function fitsAsIs(e: Embed): boolean {
  const f = e.fields ?? [];
  return f.length <= LIMITS.fields && f.every((x) => x.value.length <= LIMITS.fieldValue && x.name.length <= LIMITS.fieldName)
    && (e.description?.length ?? 0) <= LIMITS.description && (e.title?.length ?? 0) <= LIMITS.title;
}

/**
 * 추천 임베드를 메시지 제한(임베드 합계 6000자, 칸 25개, 칸 1024자) 안에 맞춘다.
 * 분량 단계를 올려 가며 전부(추천 + "모두 편성")가 들어가는 단계를 찾고, 안 되면 "모두 편성"을 먼저 뺀 채 다시 단계를 올려 본다
 * (추천 1보다 먼저 빠진다). 그래도 안 되면 앞에서부터 들어가는 추천만 남긴다.
 * 첫 추천 하나도 안 들어가면 못 간 캐릭터 칸을 먼저 빼고, 그래도 안 되면 공대를 뒤에서부터 줄이고 설명에 그 사실을 적는다.
 */
function planEmbeds(result: PlanResult, raid: RaidConfig, names: Map<string, string>, excluded: string, now: Date): Embed[] {
  const tracked = result.proficiencyTracked === true;
  const cands = result.candidates.slice(0, LIMITS.embeds);
  const numberOf = (i: number) => cands.slice(0, i + 1).filter((c) => c.kind !== 'fullPlacement').length;
  const make = (c: Candidate, i: number, opts: Omit<EmbedOpts, 'tracked'>) => candidateEmbed(c, i, numberOf(i), raid, names, excluded, now, { ...opts, tracked });
  const total = (es: Embed[]) => es.reduce((s, e) => s + embedSize(e), 0);
  // 같은 객체가 여러 번 나올 수 있으므로 위치(i)를 같이 들고 다닌다
  const all = cands.map((c, i) => ({ c, i }));
  const recs = all.filter(({ c }) => c.kind !== 'fullPlacement');
  for (const list of recs.length < all.length ? [all, recs] : [all]) {
    for (const detail of [0, 1, 2] as Detail[]) {
      const es = list.map(({ c, i }) => make(c, i, { detail }));
      if (es.every(fitsAsIs) && total(es) <= LIMITS.embedTotal) return es;
    }
  }
  const out: Embed[] = [];
  for (const { c, i } of recs) {
    const e = make(c, i, { detail: 2 });
    if (fitsAsIs(e) && total([...out, e]) <= LIMITS.embedTotal) { out.push(e); continue; }
    if (out.length > 0) break;
    const ok = (x: Embed) => fitsAsIs(x) && embedSize(x) <= LIMITS.embedTotal;
    let cut = make(c, i, { detail: 2, dropUnplaced: true });
    if (!ok(cut)) {
      let shown = Math.min(c.parties.length - 1, LIMITS.fields);
      cut = make(c, i, { detail: 2, shown, dropUnplaced: true });
      while (shown > 1 && !ok(cut)) cut = make(c, i, { detail: 2, shown: --shown, dropUnplaced: true });
    }
    out.push(cut);
    break;
  }
  return out;
}

/** 공대 추천을 임베드로 (추천 하나에 임베드 하나, 첫 추천에 ⭐) + 버튼. */
export function formatPlan(raid: RaidConfig, result: PlanResult, friends: Friend[], now: Date): MessageParts {
  const names = new Map(friends.map((f) => [f.id, f.displayName]));
  const title = raidTitle(raid);
  const excluded = excludedText(result, names);
  const buttons = [planButtons(raid)];
  if (result.candidates.length === 0) {
    const reason = result.reason ?? '가능한 공대 추천이 없어요';
    return parts(`${title}: 이번에는 공대 추천이 없어요`, [frame(now, `${ICON.party} 공대 추천`, {
      title: `${title} · 추천 없음`,
      color: COLOR.unknown,
      description: [`😢 ${reason}`, excluded, '클리어 표시나 레벨이 바뀌면 다시 계산해 보세요.'].filter(Boolean).join('\n'),
    })], buttons);
  }
  const embeds = planEmbeds(result, raid, names, excluded, now);
  const n = result.candidates.filter((c) => c.kind !== 'fullPlacement').length;
  const hasFull = result.candidates.length > n;
  const shownRecs = embeds.filter((e) => !e.title?.startsWith(FULL_PLACEMENT_TITLE)).length;
  const fullShown = embeds.length > shownRecs;
  const note = shownRecs < n ? ` (길어서 ${shownRecs}개만 보여요)` : '';
  const droppedFull = hasFull && !fullShown ? `${note ? ' ' : ' ('}모두 편성은 길어서 뺐어요, 웹 화면에서 볼 수 있어요${note ? '' : ')'}` : '';
  return parts(`${ICON.party} ${title} 공대 추천 ${n}개${hasFull ? '와 모두 편성 1개' : ''}를 찾았어요${note}${droppedFull}`, embeds, buttons);
}

// ---------- /현황, /클리어 ----------

const raidIndex = (r: ClearRecord) => RAIDS.findIndex((x) => x.name === r.raidName && x.difficulty === r.difficulty);
const mineSorted = (name: string, clears: ClearRecord[]) =>
  clears.filter((r) => r.characterName === name).sort((a, b) => raidIndex(a) - raidIndex(b));

/** 캐릭터 한 명의 이번 주 클리어: "세르카 하드 ✅ · 벨가르딘 노말 ✅" 또는 "-". */
export function clearsText(characterName: string, clears: ClearRecord[]): string {
  const mine = mineSorted(characterName, clears);
  return mine.length ? mine.map((r) => `${r.raidName} ${r.difficulty} ${ICON.clear}`).join(' · ') : '-';
}

const FRIENDS_PER_EMBED = 5;

export function formatStatus(friends: Friend[], clears: ClearRecord[], now: Date): MessageParts {
  if (friends.length === 0) return { content: NO_FRIENDS_TEXT, embeds: [] };
  friends = friends.map(visibleFriend); // 1700 미만 캐릭터는 숨긴다 (설계 수정 2026-10-16 B)
  const known = new Set(friends.flatMap((f) => f.characters.map((c) => c.name)));
  const total = clears.filter((r) => known.has(r.characterName)).length;
  const chunks: Friend[][] = [];
  for (let i = 0; i < friends.length; i += FRIENDS_PER_EMBED) chunks.push(friends.slice(i, i + FRIENDS_PER_EMBED));
  const embeds = chunks.map((chunk, i) => frame(now, `${ICON.status} 현황`, {
    title: `${ICON.status} 이번 주 클리어 현황${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`,
    color: COLOR.brand,
    fields: chunk.map((f) => ({
      name: f.displayName,
      value: f.characters.length ? f.characters.map((c) => `**${c.name}** · ${clearsText(c.name, clears)}`).join('\n') : '-',
    })),
  }, `${ICON.clear} 총 ${total}건 클리어`));
  return parts(`${ICON.status} 이번 주 클리어 현황 (총 ${total}건)`, embeds);
}

/** /클리어 메뉴 위에 붙이는 캐릭터 현재 클리어 요약. */
export function characterClearsEmbed(character: Character, clears: ClearRecord[], now: Date): Embed {
  const mine = mineSorted(character.name, clears);
  return sanitizeEmbed(frame(now, `${ICON.clear} 클리어 표시`, {
    title: `${character.role === 'support' ? ICON.support : ICON.dealer} ${character.name} · ${formatLevel(character.itemLevel)}`,
    color: mine.length ? COLOR.success : COLOR.unknown,
    description: mine.length
      ? mine.map((r) => `${ICON.clear} ${r.raidName} ${r.difficulty}`).join('\n')
      : '아직 이번 주에 표시한 클리어가 없어요',
  }, `${ICON.clear} ${mine.length}건`));
}

// ---------- /명령어, /등록, 오류 ----------

export function formatHelp(commands: CommandDef[], now: Date): MessageParts {
  const groups = [...COMMAND_GROUPS, ...commands.map((c) => c.group).filter((g) => !(COMMAND_GROUPS as readonly string[]).includes(g))];
  const fields = [...new Set(groups)]
    .map((g) => ({
      name: g,
      value: commands.filter((c) => c.group === g).map((c) => `**/${c.name}** — ${c.description}\n예: \`${c.example}\``).join('\n'),
    }))
    .filter((f) => f.value);
  return parts(`${ICON.help} 사용 가능한 명령어`, [frame(now, `${ICON.help} 도움말`, {
    title: `${ICON.help} 사용 가능한 명령어`,
    description: '`/`를 입력하면 명령어 목록이 떠요. 처음이라면 `/등록`부터 해 주세요!',
    color: COLOR.brand,
    fields,
  })]);
}

/** `/웹` 응답: 웹 화면으로 가는 링크 버튼 하나. 비밀번호는 담지 않는다. */
export function webLinkParts(url: string, now: Date): MessageParts {
  return parts(`${ICON.web} 웹으로 열기`, [frame(now, `${ICON.web} 웹`, {
    title: `${ICON.web} 웹으로 열기`,
    description: '아래 버튼을 누르면 웹 화면이 열려요. 처음 한 번은 친구들과 공유하는 비밀번호를 물어봐요.',
    color: COLOR.brand,
  })], [{ type: 1, components: [{ type: 2, style: 5, label: `${ICON.web} 웹으로 열기`, url }] }]);
}

const rosterLines = (cs: Character[], max = 8) =>
  [...cs].sort((a, b) => b.itemLevel - a.itemLevel).slice(0, max).map((c) => `**${c.name}** · ${c.className} · ${formatLevel(c.itemLevel)}`)
    .concat(cs.length > max ? [`외 ${cs.length - max}명`] : []).join('\n');

export function registerSuccess(opts: {
  displayName: string; representativeName: string; characters: Character[]; updated: boolean; now: Date;
}): MessageParts {
  const { displayName, representativeName, characters, updated, now } = opts;
  const supports = characters.filter((c) => c.role === 'support');
  const dealers = characters.filter((c) => c.role !== 'support');
  const head = updated ? '원정대 갱신 완료!' : '등록 완료! 환영해요';
  const fields: EmbedField[] = [];
  if (supports.length) fields.push({ name: `${ICON.support} 서포터 ${supports.length}`, value: rosterLines(supports) });
  if (dealers.length) fields.push({ name: `${ICON.dealer} 딜러 ${dealers.length}`, value: rosterLines(dealers) });
  return parts(`${ICON.celebrate} ${displayName} 님 ${head}`, [frame(now, `${ICON.celebrate} 등록`, {
    title: `${ICON.celebrate} ${head}`,
    color: COLOR.success,
    description: `**${displayName}** 님 · ${representativeName} 원정대 캐릭터 ${characters.length}개를 불러왔어요\n`
      + `${ICON.support} 서포터 ${supports.length} · ${ICON.dealer} 딜러 ${dealers.length}`,
    fields,
  })]);
}

/** /숙련도 저장 확인: "A1 · 세르카 → 숙련" 한 줄과 짧은 설명. */
export function proficiencySaved(characterName: string, raidName: string, level: Proficiency, now: Date): MessageParts {
  const line = `${characterName} · ${raidName} → ${level}`;
  return parts(`${ICON.proficiency} ${line}`, [frame(now, `${ICON.proficiency} 숙련도`, {
    title: `${ICON.proficiency} ${line}`,
    color: COLOR.success,
    description: `**${characterName}** · ${raidName} → ${PROFICIENCY_TEXT[level]}\n`
      + '공대 추천에서 숙련자는 공대마다 고르게, 클경은 나눠서 넣어요. (정하지 않은 레이드는 반숙)',
  })]);
}

/** 빨간 오류 임베드: 친절한 한 줄 원인 + 해결 방법. content는 원인 그대로 둔다. */
export function errorParts(cause: string, fix: string, now: Date): MessageParts {
  return parts(cause, [frame(now, `${ICON.error} 알림`, {
    title: `${ICON.error} ${cause}`,
    color: COLOR.error,
    fields: [{ name: '해결 방법', value: fix }],
  })]);
}

export const NO_FRIENDS_TEXT = '등록된 친구가 없어요. 먼저 `/등록`으로 대표 캐릭터를 등록해 주세요.';
