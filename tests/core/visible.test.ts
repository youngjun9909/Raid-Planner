import { describe, it, expect } from 'vitest';
import { visibleCharacters, visibleFriend } from '@/core/visible';
import type { Character, Friend } from '@/core/types';

const ch = (name: string, itemLevel: number): Character => ({ name, className: 'x', role: 'dealer', itemLevel, combatPower: null });

describe('visibleCharacters (1700 미만은 화면에서 숨김)', () => {
  it('MIN_RAID_LEVEL(1700) 이상만, 순서 유지, 원본은 그대로', () => {
    const cs = [ch('a', 1750), ch('b', 1699.99), ch('c', 1700), ch('d', 1500)];
    expect(visibleCharacters(cs).map((c) => c.name)).toEqual(['a', 'c']);
    expect(cs).toHaveLength(4);
  });
  it('visibleFriend: characters만 거르고 나머지(숙련도·가는 난이도 포함)는 그대로', () => {
    const f: Friend = { id: 'f', displayName: 'F', representativeName: 'a', characters: [ch('a', 1750), ch('b', 1600)], proficiency: { 'b|세르카': '숙련' } };
    const v = visibleFriend(f);
    expect(v.characters.map((c) => c.name)).toEqual(['a']);
    expect(v.proficiency).toEqual({ 'b|세르카': '숙련' });
    expect(f.characters).toHaveLength(2);
  });
});
