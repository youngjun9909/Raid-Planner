import { MIN_RAID_LEVEL } from './raids';
import type { Character, Friend } from './types';

/**
 * 화면/응답에 보이는 캐릭터 (설계 수정 2026-10-16-friend-first-amendment.md B): 가장 낮은 레이드 입장 레벨
 * (MIN_RAID_LEVEL, 지금 1700) 이상만. 저장소에서는 지우지 않고 화면/응답을 만들 때 여기서 거른다.
 * 편성 계산은 원래 레벨 자격으로 거르므로 전체 목록을 그대로 받는다.
 */
export const visibleCharacters = (characters: Character[]): Character[] =>
  characters.filter((c) => c.itemLevel >= MIN_RAID_LEVEL);

/** 응답용 친구: characters만 보이는 캐릭터로 거른다 (숙련도·가는 난이도 등 나머지는 그대로). */
export const visibleFriend = <F extends Friend>(f: F): F => ({ ...f, characters: visibleCharacters(f.characters) });
