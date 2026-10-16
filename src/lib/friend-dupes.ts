import type { Friend } from '@/core/types';

/**
 * names 중 하나라도 이미 다른 친구의 대표 캐릭터이거나 캐릭터이면 그 친구를 돌려준다.
 * exceptId 친구(갱신 중인 본인)는 건너뛴다. 클리어 기록과 공대 배치가 캐릭터 이름으로 묶이므로
 * 같은 캐릭터가 두 친구에 동시에 들어가지 않게 막는다.
 */
export function findOwner(friends: Friend[], names: string[], exceptId?: string): Friend | undefined {
  const wanted = new Set(names);
  return friends.find(
    (f) => f.id !== exceptId && (wanted.has(f.representativeName) || f.characters.some((c) => wanted.has(c.name))),
  );
}
