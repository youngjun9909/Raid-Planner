import { isTargetEligible } from './difficulty';
import type { Character, ClearRecord, Friend, RaidConfig } from './types';

/**
 * 편성 후보 캐릭터 (설계 수정 2026-10-16-friend-first-amendment.md A):
 * 아이템 레벨 ≥ 입장 레벨, 이번 주에 그 레이드 이름을 아직 안 감(어느 난이도든), 그리고 가는 난이도 == 레이드 난이도.
 * targetOf는 캐릭터 이름 → 직접 정한 가는 난이도(난이도 이름 또는 `안 감`), 없으면 자동 기본값.
 */
export function eligibleCharacters(
  friend: Friend,
  raid: RaidConfig,
  clears: ClearRecord[],
  targetOf?: (characterName: string) => string | undefined,
): Character[] {
  const cleared = new Set(clears.filter((c) => c.raidName === raid.name).map((c) => c.characterName));
  return friend.characters.filter((c) => !cleared.has(c.name) && isTargetEligible(c.itemLevel, raid, targetOf?.(c.name)));
}
