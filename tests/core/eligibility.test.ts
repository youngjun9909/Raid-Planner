import { describe, it, expect } from 'vitest';
import { eligibleCharacters } from '@/core/eligibility';
import { getRaid } from '@/core/raids';
import type { Character, Friend } from '@/core/types';

const ch = (name: string, itemLevel: number, role: 'dealer' | 'support'): Character => ({
  name, className: 'x', role, itemLevel, combatPower: null,
});
const friend: Friend = {
  id: 'f1', displayName: 'F', representativeName: 'A',
  characters: [ch('A', 1740, 'dealer'), ch('B', 1700, 'dealer'), ch('C', 1735, 'support')],
};
const names = (cs: Character[]) => cs.map((c) => c.name);
const serkaHard = getRaid('serka-hard')!;

describe('eligibleCharacters', () => {
  it('입장 레벨 미달은 제외 (세르카 하드 1730: B 제외)', () => {
    expect(names(eligibleCharacters(friend, serkaHard, []))).toEqual(['A', 'C']);
  });
  it('같은 난이도 클리어한 캐릭터는 제외', () => {
    const clears = [{ characterName: 'A', raidName: '세르카', difficulty: '하드' }];
    expect(names(eligibleCharacters(friend, serkaHard, clears))).toEqual(['C']);
  });
  it('같은 레이드의 다른 난이도 클리어도 제외', () => {
    const clears = [{ characterName: 'A', raidName: '세르카', difficulty: '노말' }];
    expect(names(eligibleCharacters(friend, serkaHard, clears))).toEqual(['C']);
  });
  it('다른 레이드 클리어는 영향 없음', () => {
    const clears = [{ characterName: 'A', raidName: '벨가르딘', difficulty: '하드' }];
    expect(names(eligibleCharacters(friend, serkaHard, clears))).toEqual(['A', 'C']);
  });
  it('캐릭터 단위 판단: A만 클리어해도 같은 친구의 C는 남는다', () => {
    const clears = [{ characterName: 'A', raidName: '세르카', difficulty: '하드' }];
    expect(names(eligibleCharacters(friend, serkaHard, clears))).toContain('C');
  });
});
