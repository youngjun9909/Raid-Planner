import { RAIDS } from './raids';
import type { Friend, RaidConfig } from './types';

/**
 * 가는 난이도 (설계 수정 2026-10-16-friend-first-amendment.md A).
 *
 * 캐릭터 × 레이드 이름마다 "어떤 난이도로 가는지"를 둔다. 정하지 않으면 자동 기본값(입장 가능한 가장 높은 난이도),
 * 직접 정한 값은 그 레이드 이름의 난이도 중 하나 또는 `안 감`. 편성은 가는 난이도가 레이드 난이도와 같은 캐릭터만 후보로 본다.
 */

/** 그 레이드를 아예 안 간다는 직접 정한 값. */
export const SKIP_DIFFICULTY = '안 감';

/** 가는 난이도를 정하는 단위인 레이드 이름 (설정 순서, 중복 없음). */
export const TARGET_RAID_NAMES: string[] = [...new Set(RAIDS.map((r) => r.name))];

/** 그 레이드 이름의 난이도들 (입장 레벨 순서, 같으면 설정 순서). */
function raidsOf(raidName: string): RaidConfig[] {
  return RAIDS.filter((r) => r.name === raidName)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.minLevel - b.r.minLevel || a.i - b.i)
    .map(({ r }) => r);
}

/** 그 레이드 이름의 난이도 이름 목록 (입장 레벨 순서). 모르는 레이드면 []. */
export const difficultiesOf = (raidName: string): string[] => raidsOf(raidName).map((r) => r.difficulty);

/** 저장/API 값 검사: 그 레이드 이름에 있는 난이도이거나 `안 감`. */
export function isTargetDifficultyFor(raidName: string, value: unknown): value is string {
  if (typeof value !== 'string' || !TARGET_RAID_NAMES.includes(raidName)) return false;
  return value === SKIP_DIFFICULTY || difficultiesOf(raidName).includes(value);
}

/** 자동 기본값: 입장 레벨 ≤ 아이템 레벨인 난이도 중 가장 높은 것. 없으면 null (그 레이드는 해당 없음). */
export function autoDifficulty(itemLevel: number, raidName: string): string | null {
  let best: string | null = null;
  for (const r of raidsOf(raidName)) if (r.minLevel <= itemLevel) best = r.difficulty;
  return best;
}

/** 실제로 가는 난이도: 직접 정한 값(안 감이면 null), 없으면 자동 기본값. */
export function effectiveDifficulty(itemLevel: number, raidName: string, override: string | undefined): string | null {
  if (override === SKIP_DIFFICULTY) return null;
  return override ?? autoDifficulty(itemLevel, raidName);
}

/**
 * 편성 자격의 레벨·난이도 부분: 아이템 레벨 ≥ 입장 레벨이고 가는 난이도 == 레이드 난이도.
 * (레벨보다 높은 난이도를 직접 정해도 레벨 규칙이 이긴다. 클리어 여부는 eligibleCharacters가 본다.)
 */
export function isTargetEligible(itemLevel: number, raid: RaidConfig, override: string | undefined): boolean {
  return itemLevel >= raid.minLevel && effectiveDifficulty(itemLevel, raid.name, override) === raid.difficulty;
}

/** 저장 키: `<캐릭터 이름>|<레이드 이름>` (숙련도와 같은 모양). */
export const targetDifficultyKey = (characterName: string, raidName: string) => `${characterName}|${raidName}`;

/** 저장 키에서 레이드 이름 (레이드 이름에는 '|'가 없으므로 마지막 '|' 뒤). */
export const raidNameOfKey = (key: string): string => key.slice(key.lastIndexOf('|') + 1);

/**
 * 편성 입력용 조회 함수: 친구 목록(저장소가 가는 난이도를 붙인 것)에서 그 레이드 이름에 직접 정한 값을 찾는다.
 * 정하지 않았으면 undefined (자동 기본값).
 */
export function targetDifficultyLookup(friends: Friend[], raidName: string): (friendId: string, characterName: string) => string | undefined {
  const byId = new Map(friends.map((f) => [f.id, f]));
  return (friendId, characterName) => byId.get(friendId)?.targetDifficulty?.[targetDifficultyKey(characterName, raidName)];
}
