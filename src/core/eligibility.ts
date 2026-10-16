import type { Character, ClearRecord, Friend, RaidConfig } from './types';

export function eligibleCharacters(friend: Friend, raid: RaidConfig, clears: ClearRecord[]): Character[] {
  const cleared = new Set(clears.filter((c) => c.raidName === raid.name).map((c) => c.characterName));
  return friend.characters.filter((c) => c.itemLevel >= raid.minLevel && !cleared.has(c.name));
}
