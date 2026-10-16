import { RAIDS } from './raids';
import type { Friend, Party, Proficiency, ProficiencySummary, Slot } from './types';

/** 숙련도 (설계 수정 2026-10-16-proficiency-amendment.md). 높은 순서. */
export const PROFICIENCIES: readonly Proficiency[] = ['숙련', '반숙', '클경'];
export const DEFAULT_PROFICIENCY: Proficiency = '반숙';
/** 공대별 숙련도 점수: 숙련=3, 반숙=2, 클경=1. */
export const PROFICIENCY_SCORE: Record<Proficiency, number> = { 숙련: 3, 반숙: 2, 클경: 1 };

export const isProficiency = (v: unknown): v is Proficiency => v === '숙련' || v === '반숙' || v === '클경';

/** 숙련도를 정하는 단위인 레이드 이름 (난이도와 무관), 설정 순서. */
export const RAID_NAMES_FOR_PROFICIENCY: string[] = [...new Set(RAIDS.map((r) => r.name))];

/** 저장 키: `<캐릭터 이름>|<레이드 이름>`. 레이드 이름에는 '|'가 없다. */
export const proficiencyKey = (characterName: string, raidName: string) => `${characterName}|${raidName}`;

/** 친구의 그 캐릭터·레이드 숙련도 (정하지 않았으면 반숙). */
export function proficiencyOf(friend: Pick<Friend, 'proficiency'> | undefined, characterName: string, raidName: string): Proficiency {
  return friend?.proficiency?.[proficiencyKey(characterName, raidName)] ?? DEFAULT_PROFICIENCY;
}

/** 편성 입력용 조회 함수: 친구 목록(저장소가 숙련도를 붙인 것)에서 그 레이드 이름의 숙련도를 찾는다. */
export function proficiencyLookup(friends: Friend[], raidName: string): (friendId: string, characterName: string) => Proficiency {
  const byId = new Map(friends.map((f) => [f.id, f]));
  return (friendId, characterName) => proficiencyOf(byId.get(friendId), characterName, raidName);
}

/** 슬롯 목록의 숙련도 요약 (친구 자리만, 표시가 없으면 반숙). */
export function summarizeProficiency(slots: Slot[]): ProficiencySummary {
  const out: ProficiencySummary = { 숙련: 0, 반숙: 0, 클경: 0, noExpert: true };
  for (const s of slots) if (s.kind === 'friend') out[s.proficiency ?? DEFAULT_PROFICIENCY]++;
  out.noExpert = out.숙련 === 0;
  return out;
}

/** 공대의 숙련도 요약: 편성 결과에 있으면 그것, 없으면(예전 응답) 슬롯에서 계산. */
export const partyProficiency = (p: Party): ProficiencySummary => p.proficiency ?? summarizeProficiency(p.slots);

/** "숙련 1 · 반숙 1 · 클경 0" (웹/디스코드 공통). */
export const proficiencySummaryText = (s: ProficiencySummary): string => `숙련 ${s.숙련} · 반숙 ${s.반숙} · 클경 ${s.클경}`;

export const NO_EXPERT_TEXT = '숙련자 없음';
