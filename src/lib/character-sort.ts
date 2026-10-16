import type { Character } from '@/core/types';

/**
 * 전투력 높은 순으로 정렬한 복사본을 돌려준다. 전투력이 없는(null) 캐릭터는 맨 뒤에서 아이템 레벨 높은 순.
 * 동점이면 아이템 레벨 높은 순, 그다음 이름순. 원본은 건드리지 않는다.
 */
export function sortCharactersByPower<T extends Character>(characters: readonly T[]): T[] {
  return [...characters].sort((a, b) => {
    if (a.combatPower !== b.combatPower) {
      if (a.combatPower === null) return 1;
      if (b.combatPower === null) return -1;
      return b.combatPower - a.combatPower;
    }
    return b.itemLevel - a.itemLevel || a.name.localeCompare(b.name, 'ko');
  });
}
