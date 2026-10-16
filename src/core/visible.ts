import { MIN_RAID_LEVEL } from './raids';
import type { Character, Friend } from './types';

/**
 * 화면/응답에 보이는 캐릭터 (설계 수정 2026-10-16-friend-first-amendment.md B): 가장 낮은 레이드 입장 레벨
 * (MIN_RAID_LEVEL, 지금 1700) 이상만. 저장소에서는 지우지 않고 화면/응답을 만들 때 여기서 거른다.
 * 편성 계산은 원래 레벨 자격으로 거르므로 전체 목록을 그대로 받는다.
 */
export const visibleCharacters = (characters: Character[]): Character[] =>
  characters.filter((c) => c.itemLevel >= MIN_RAID_LEVEL);

/** 키 `<캐릭터 이름>|<레이드 이름>`인 값 중 보이는 캐릭터의 것만 남긴다. */
function onlyVisible<V>(m: Record<string, V>, names: Set<string>): Record<string, V> {
  return Object.fromEntries(Object.entries(m).filter(([k]) => names.has(k.slice(0, k.lastIndexOf('|')))));
}

/**
 * 응답용 친구: characters를 보이는 캐릭터로 거르고, 숙련도·가는 난이도(키 `<캐릭터 이름>|<레이드 이름>`)도 보이는 캐릭터의
 * 것만 남긴다 (필드가 없으면 없는 그대로). 나머지 필드는 그대로, 원본은 바꾸지 않는다.
 */
export const visibleFriend = <F extends Friend>(f: F): F => {
  const characters = visibleCharacters(f.characters);
  const names = new Set(characters.map((c) => c.name));
  const out: F = { ...f, characters };
  if (f.proficiency) out.proficiency = onlyVisible(f.proficiency, names);
  if (f.targetDifficulty) out.targetDifficulty = onlyVisible(f.targetDifficulty, names);
  return out;
};
