import { RAIDS } from '@/core/raids';
import { proficiencyKey } from '@/core/proficiency';
import { SKIP_DIFFICULTY, autoDifficulty, difficultiesOf, effectiveDifficulty, targetDifficultyKey, targetDifficultyLookup } from '@/core/difficulty';
import { eligibleCharacters } from '@/core/eligibility';
import { visibleFriend } from '@/core/visible';
import type { Character, ClearRecord, Friend, PlanSummary, Proficiency, RaidConfig, Role, Slot, Tier } from '@/core/types';

/** 레이드 이름별 묶음 (설정 순서 유지). 클리어 표의 열과 레이드 선택 화면에 쓴다. */
export interface RaidGroup { name: string; raids: RaidConfig[]; }

export const RAID_GROUPS: RaidGroup[] = RAIDS.reduce<RaidGroup[]>((groups, raid) => {
  const g = groups.find((x) => x.name === raid.name);
  if (g) g.raids.push(raid);
  else groups.push({ name: raid.name, raids: [raid] });
  return groups;
}, []);

export const RAID_NAMES: string[] = RAID_GROUPS.map((g) => g.name);

/** 드롭다운 값: 이번 주에 간 난이도, 안 갔으면 ''. */
export function clearValue(clears: ClearRecord[], characterName: string, raidName: string): string {
  return clears.find((c) => c.characterName === characterName && c.raidName === raidName)?.difficulty ?? '';
}

/**
 * 드롭다운 하나를 바꾼 뒤 그 캐릭터의 전체 클리어 목록 (PUT /api/clears 본문의 records).
 * 레이드 이름당 한 난이도만 남는다: 같은 레이드의 다른 난이도를 고르면 기존 값을 대신한다.
 */
export function recordsAfterChange(
  clears: ClearRecord[],
  characterName: string,
  raidName: string,
  difficulty: string,
): { raidName: string; difficulty: string }[] {
  const mine = clears.filter((c) => c.characterName === characterName);
  const out: { raidName: string; difficulty: string }[] = [];
  let placed = false;
  for (const c of mine) {
    if (c.raidName === raidName) {
      if (!placed && difficulty) out.push({ raidName, difficulty });
      placed = true;
    } else {
      out.push({ raidName: c.raidName, difficulty: c.difficulty });
    }
  }
  if (!placed && difficulty) out.push({ raidName, difficulty });
  return out;
}

/** 로컬 상태에도 같은 변경을 반영한 클리어 목록. */
export function applyClearChange(
  clears: ClearRecord[],
  characterName: string,
  records: { raidName: string; difficulty: string }[],
): ClearRecord[] {
  return [...clears.filter((c) => c.characterName !== characterName), ...records.map((r) => ({ characterName, ...r }))];
}

const cpFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
export function formatCP(cp: number | null): string {
  return cp === null ? '—' : cpFormat.format(Math.round(cp));
}

export function formatLevel(level: number): string {
  return level.toFixed(2).replace(/\.?0+$/, '');
}

export function formatRange(raid: RaidConfig): string {
  const { min, max } = raid.recommendedCP;
  return max === null ? `${formatCP(min)} 이상` : `${formatCP(min)}~${formatCP(max)}`;
}

export const ROLE_LABEL: Record<Role, string> = { support: '서포터', dealer: '딜러' };

/** 단계는 색만으로 구분하지 않도록 아이콘과 글자를 함께 쓴다. */
export const TIER_META: Record<Tier, { label: string; icon: string; hint: string }> = {
  comfortable: { label: '여유', icon: '◆', hint: '딜러 평균이 권장 전투력 이상' },
  tight: { label: '빠듯함', icon: '▲', hint: '권장 최소치의 90% 이상' },
  risky: { label: '위험', icon: '✕', hint: '권장 최소치의 90% 미만' },
  unknown: { label: '모름', icon: '?', hint: '전투력을 아는 딜러가 없어요' },
};

export function countExternals(slots: Slot[]): { support: number; dealer: number } {
  let support = 0;
  let dealer = 0;
  for (const s of slots) {
    if (s.kind !== 'external') continue;
    if (s.role === 'support') support++;
    else dealer++;
  }
  return { support, dealer };
}

/**
 * 추천 한 줄 요약 (웹/디스코드 공통):
 * "친구 2명 · 캐릭터 3개 편성 · 공대 2개 · 외부 5명 필요 (서포터 2, 딜러 3)", 외부인이 없으면 "… · 친구들만으로 구성 가능".
 * 캐릭터 수는 편성된 캐릭터만 센다 (못 간 캐릭터는 따로 보여 준다).
 */
export function planSummaryText(s: PlanSummary): string {
  const head = `친구 ${s.friendCount}명 · 캐릭터 ${s.characterCount}개 편성 · 공대 ${s.partyCount}개`;
  return s.externalCount === 0
    ? `${head} · 친구들만으로 구성 가능`
    : `${head} · 외부 ${s.externalCount}명 필요 (서포터 ${s.externalSupports}, 딜러 ${s.externalDealers})`;
}

/**
 * 숙련도 표시: 색만으로 구분하지 않도록 모양 아이콘(꽉 찬 원 / 반 찬 원 / 빈 원)과 글자를 함께 쓴다.
 * cls는 CSS 클래스 이름 (prof--expert 등).
 */
export const PROFICIENCY_META: Record<Proficiency, { icon: string; cls: 'expert' | 'mid' | 'novice'; hint: string }> = {
  숙련: { icon: '●', cls: 'expert', hint: '여러 번 클리어해서 익숙해요' },
  반숙: { icon: '◐', cls: 'mid', hint: '어느 정도 알아요 (정하지 않으면 반숙)' },
  클경: { icon: '○', cls: 'novice', hint: '클리어 경험만 있어요' },
};

/** 한 친구의 한 칸(캐릭터 × 레이드 이름) 숙련도를 바꾼 친구 목록. null이면 지워 기본값(반숙)으로. 원본은 그대로. */
export function withProficiency(
  friends: Friend[],
  friendId: string,
  characterName: string,
  raidName: string,
  level: Proficiency | null,
): Friend[] {
  const key = proficiencyKey(characterName, raidName);
  return friends.map((f) => {
    if (f.id !== friendId) return f;
    const { proficiency: prev, ...rest } = f;
    const next: Record<string, Proficiency> = { ...(prev ?? {}) };
    if (level === null) delete next[key]; else next[key] = level;
    return Object.keys(next).length ? { ...rest, proficiency: next } : rest;
  });
}

/** 한 친구의 한 칸(캐릭터 × 레이드 이름) 가는 난이도를 바꾼 친구 목록. null이면 지워 자동으로. 원본은 그대로. */
export function withTargetDifficulty(
  friends: Friend[],
  friendId: string,
  characterName: string,
  raidName: string,
  value: string | null,
): Friend[] {
  const key = targetDifficultyKey(characterName, raidName);
  return friends.map((f) => {
    if (f.id !== friendId) return f;
    const { targetDifficulty: prev, ...rest } = f;
    const next: Record<string, string> = { ...(prev ?? {}) };
    if (value === null) delete next[key]; else next[key] = value;
    return Object.keys(next).length ? { ...rest, targetDifficulty: next } : rest;
  });
}

/**
 * 캐릭터 카드의 레이드 칩 하나 (레이드 이름 단위).
 * auto = 자동 기본값, override = 직접 정한 값(난이도 또는 `안 감`), target = 실제로 가는 난이도(안 감이면 null),
 * cleared = 이번 주에 간 난이도(안 갔으면 ''), shown = 칩에 보일 난이도(갔으면 간 난이도, 아니면 가는 난이도 또는 `안 감`),
 * options = 레벨이 되는 난이도들 (입장 레벨 순서), proficiency = 직접 정한 숙련도.
 */
export interface RaidChipModel {
  raidName: string;
  auto: string;
  override: string | undefined;
  target: string | null;
  cleared: string;
  shown: string;
  options: string[];
  proficiency: Proficiency | undefined;
}

/** 캐릭터가 갈 수 있는 레이드 이름마다 칩 (아이템 레벨 ≥ 그 레이드 이름의 가장 낮은 입장 레벨), 설정 순서. */
export function raidChips(friend: Friend, character: Character, clears: ClearRecord[]): RaidChipModel[] {
  const out: RaidChipModel[] = [];
  for (const g of RAID_GROUPS) {
    const auto = autoDifficulty(character.itemLevel, g.name);
    if (auto === null) continue;
    const override = friend.targetDifficulty?.[targetDifficultyKey(character.name, g.name)];
    const target = effectiveDifficulty(character.itemLevel, g.name, override);
    const cleared = clearValue(clears, character.name, g.name);
    const levels = new Map(g.raids.map((r) => [r.difficulty, r.minLevel]));
    out.push({
      raidName: g.name,
      auto,
      override,
      target,
      cleared,
      shown: cleared || (target ?? SKIP_DIFFICULTY),
      options: difficultiesOf(g.name).filter((d) => (levels.get(d) ?? Infinity) <= character.itemLevel),
      proficiency: friend.proficiency?.[proficiencyKey(character.name, g.name)],
    });
  }
  return out;
}

/** 칩을 한 번 눌렀을 때 기록할 난이도: 갔으면 '' (해제), 아니면 가는 난이도, 안 감이면 null (아무 것도 안 함). */
export function chipToggleDifficulty(chip: RaidChipModel): string | null {
  if (chip.cleared) return '';
  return chip.target;
}

/**
 * 레이드 고르기 화면의 후보 캐릭터 수 (레이드 id → 수). 참석하는 친구의 보이는 캐릭터 중 편성 자격
 * (레벨, 이번 주 미클리어, 가는 난이도 == 그 난이도)을 통과한 수. 자격 규칙은 core의 eligibleCharacters를 그대로 쓴다.
 */
export function candidateCounts(friends: Friend[], attendeeIds: string[], clears: ClearRecord[]): Record<string, number> {
  const attending = friends.filter((f) => attendeeIds.includes(f.id)).map(visibleFriend);
  const out: Record<string, number> = {};
  for (const raid of RAIDS) {
    const targetOf = targetDifficultyLookup(attending, raid.name);
    out[raid.id] = attending.reduce((n, f) => n + eligibleCharacters(f, raid, clears, (c) => targetOf(f.id, c)).length, 0);
  }
  return out;
}
