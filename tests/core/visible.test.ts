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
  it('visibleFriend: characters와 숙련도·가는 난이도(키 <캐릭터>|<레이드>)를 보이는 캐릭터만 남기고, 원본은 그대로', () => {
    const f: Friend = {
      id: 'f', displayName: 'F', representativeName: 'a', characters: [ch('a', 1750), ch('b', 1600)],
      proficiency: { 'b|세르카': '숙련', 'a|세르카': '클경', 'a|카제로스': '숙련' },
      targetDifficulty: { 'b|세르카': '노말', 'a|세르카': '안 감' },
    };
    const v = visibleFriend(f);
    expect(v.characters.map((c) => c.name)).toEqual(['a']);
    expect(v.proficiency).toEqual({ 'a|세르카': '클경', 'a|카제로스': '숙련' });
    expect(v.targetDifficulty).toEqual({ 'a|세르카': '안 감' });
    expect(f.characters).toHaveLength(2);
    expect(Object.keys(f.proficiency!)).toHaveLength(3);
    expect(Object.keys(f.targetDifficulty!)).toHaveLength(2);
  });
  it('visibleFriend: 숙련도·가는 난이도가 없으면 없는 그대로, 다른 필드도 그대로', () => {
    const f: Friend = { id: 'f', displayName: 'F', discordUserId: 'u', representativeName: 'a', characters: [ch('a', 1750)] };
    const v = visibleFriend(f);
    expect(v).toEqual(f);
    expect('proficiency' in v).toBe(false);
    expect('targetDifficulty' in v).toBe(false);
  });
});
