import { describe, it, expect } from 'vitest';
import { eligibleCharacters } from '@/core/eligibility';
import { getRaid } from '@/core/raids';
import type { Character, Friend } from '@/core/types';

const ch = (name: string, itemLevel: number, role: 'dealer' | 'support'): Character => ({
  name, className: 'x', role, itemLevel, combatPower: null,
});
// 세르카: 노말 1710 / 하드 1730 / 나이트메어 1740. A, C는 자동으로 하드, B는 노말, D는 나이트메어.
const friend: Friend = {
  id: 'f1', displayName: 'F', representativeName: 'A',
  characters: [ch('A', 1735, 'dealer'), ch('B', 1700, 'dealer'), ch('C', 1731, 'support'), ch('D', 1745, 'dealer')],
};
const names = (cs: Character[]) => cs.map((c) => c.name);
const serkaHard = getRaid('serka-hard')!;
const serkaNightmare = getRaid('serka-nightmare')!;

describe('eligibleCharacters', () => {
  it('입장 레벨 미달은 제외 (세르카 하드 1730: B 제외), 가는 난이도가 다른 D(나이트메어)도 제외', () => {
    expect(names(eligibleCharacters(friend, serkaHard, []))).toEqual(['A', 'C']);
    expect(names(eligibleCharacters(friend, serkaNightmare, []))).toEqual(['D']);
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
  it('직접 정한 가는 난이도: D에 하드를 정하면 하드 후보, A에 안 감이면 제외, B에 하드를 정해도 레벨 미달이면 제외', () => {
    const over: Record<string, string> = { D: '하드', A: '안 감', B: '하드' };
    expect(names(eligibleCharacters(friend, serkaHard, [], (n) => over[n]))).toEqual(['C', 'D']);
    expect(names(eligibleCharacters(friend, serkaNightmare, [], (n) => over[n]))).toEqual([]);
  });
});
