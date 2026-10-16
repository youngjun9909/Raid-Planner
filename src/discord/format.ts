/**
 * 디스코드 메시지 만들기 (순수 함수). 모든 결과는 디스코드 제한(LIMITS) 안으로 맞춘다.
 * 아이콘/색은 theme.ts에서만 가져온다.
 */
import { RAIDS } from '@/core/raids';
import { weekKey } from '@/core/week';
import type { Candidate, Character, ClearRecord, Friend, Party, PlanResult, RaidConfig, Slot, Tier } from '@/core/types';
import { countExternals, formatCP, formatLevel, formatRange } from '@/lib/view-model';
import { COMMAND_GROUPS, raidTitle, type CommandDef } from './commands';
import { BOT_NAME, COLOR, GAUGE, ICON, TIER_BADNESS, TIER_COLOR, TIER_TEXT } from './theme';
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

/** 후보 한 줄 요약: "평균 전투력 3,900 · 권장 3,600~4,000 · 🟢 여유". */
export function summaryLine(avg: number | null, raid: RaidConfig, tier: Tier): string {
  return `평균 전투력 ${avg === null ? '정보 없음' : formatCP(avg)} · 권장 ${formatRange(raid)} · ${TIER_TEXT[tier]}`;
}

// ---------- /공대 ----------

function memberLine(slot: Slot, names: Map<string, string>): string {
  if (slot.kind === 'external') return `${ICON.external} 외부 ${slot.role === 'support' ? '서포터' : '딜러'} 구하기`;
  const c = slot.character;
  const owner = names.get(slot.friendId) ?? '?';
  return c.role === 'support'
    ? `${ICON.support} **${c.name}** · ${formatLevel(c.itemLevel)} · ${owner}`
    : `${ICON.dealer} **${c.name}** · ${formatLevel(c.itemLevel)} · CP ${formatCP(c.combatPower)} · ${owner}`;
}

function partyField(p: Party, i: number, raid: RaidConfig, names: Map<string, string>): EmbedField {
  return {
    name: `공대 ${i + 1} · ${TIER_TEXT[p.tier]}`,
    value: [`\`${gauge(p.dealerAvgCP, raid.recommendedCP.min)}\``, ...p.slots.map((s) => memberLine(s, names))].join('\n'),
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

/** 공대들의 딜러 평균을 다시 평균 (모르는 공대는 뺀다). */
function overallAvg(parties: Party[]): number | null {
  const avgs = parties.map((p) => p.dealerAvgCP).filter((v): v is number => v !== null);
  return avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
}

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

function candidateEmbed(c: Candidate, i: number, raid: RaidConfig, names: Map<string, string>, excluded: string, now: Date): Embed {
  const fields: EmbedField[] = [];
  c.parties.forEach((p, j) => {
    if (j > 0) fields.push(SPACER);
    fields.push(partyField(p, j, raid, names));
  });
  const description = [
    summaryLine(overallAvg(c.parties), raid, worstTier(c.parties)),
    ...(i === 0 && excluded ? [excluded] : []),
  ].join('\n');
  return frame(now, `${ICON.party} 공대 후보`, {
    title: `${i === 0 ? `${ICON.star} 추천 · ` : `후보 ${i + 1} · `}${raidTitle(raid)}`,
    color: TIER_COLOR[worstTier(c.parties)],
    description,
    fields,
  }, `${ICON.external} ${externalFooter(c.parties)}`);
}

/** 공대 후보를 임베드로 (후보 하나에 임베드 하나, 첫 후보에 ⭐ 추천) + 버튼. */
export function formatPlan(raid: RaidConfig, result: PlanResult, friends: Friend[], now: Date): MessageParts {
  const names = new Map(friends.map((f) => [f.id, f.displayName]));
  const title = raidTitle(raid);
  const excluded = excludedText(result, names);
  const buttons = [planButtons(raid)];
  if (result.candidates.length === 0) {
    const reason = result.reason ?? '가능한 공대 후보가 없어요';
    return parts(`${title}: 이번에는 공대 후보가 없어요`, [frame(now, `${ICON.party} 공대 후보`, {
      title: `${title} · 후보 없음`,
      color: COLOR.unknown,
      description: [`😢 ${reason}`, excluded, '클리어 표시나 레벨이 바뀌면 다시 계산해 보세요.'].filter(Boolean).join('\n'),
    })], buttons);
  }
  const embeds = result.candidates.map((c, i) => candidateEmbed(c, i, raid, names, excluded, now));
  return parts(`${ICON.party} ${title} 공대 후보 ${result.candidates.length}개를 찾았어요`, embeds, buttons);
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

/** 빨간 오류 임베드: 친절한 한 줄 원인 + 해결 방법. content는 원인 그대로 둔다. */
export function errorParts(cause: string, fix: string, now: Date): MessageParts {
  return parts(cause, [frame(now, `${ICON.error} 알림`, {
    title: `${ICON.error} ${cause}`,
    color: COLOR.error,
    fields: [{ name: '해결 방법', value: fix }],
  })]);
}

export const NO_FRIENDS_TEXT = '등록된 친구가 없어요. 먼저 `/등록`으로 대표 캐릭터를 등록해 주세요.';
