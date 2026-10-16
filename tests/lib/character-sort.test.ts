import { describe, expect, it } from 'vitest';
import { sortCharactersByPower } from '@/lib/character-sort';
import type { Character } from '@/core/types';

const c = (name: string, combatPower: number | null, itemLevel = 1700): Character => ({
  name, className: '버서커', role: 'dealer', itemLevel, combatPower,
});

describe('sortCharactersByPower', () => {
  it('전투력 높은 순으로 정렬한다', () => {
    expect(sortCharactersByPower([c('a', 100), c('b', 300), c('c', 200)]).map((x) => x.name)).toEqual(['b', 'c', 'a']);
  });
  it('전투력이 없는 캐릭터는 맨 뒤에서 아이템 레벨 높은 순이다', () => {
    const out = sortCharactersByPower([c('n1', null, 1600), c('p', 50, 1500), c('n2', null, 1750)]);
    expect(out.map((x) => x.name)).toEqual(['p', 'n2', 'n1']);
  });
  it('전투력이 같으면 아이템 레벨 높은 순, 그다음 이름순', () => {
    const out = sortCharactersByPower([c('나', 100, 1700), c('가', 100, 1700), c('다', 100, 1710)]);
    expect(out.map((x) => x.name)).toEqual(['다', '가', '나']);
  });
  it('원본 배열과 캐릭터를 바꾸지 않는다', () => {
    const input = [c('a', 1), c('b', 2)];
    const snapshot = structuredClone(input);
    const out = sortCharactersByPower(input);
    expect(out).not.toBe(input);
    expect(input).toEqual(snapshot);
  });
  it('빈 목록은 빈 목록', () => {
    expect(sortCharactersByPower([])).toEqual([]);
  });
});
