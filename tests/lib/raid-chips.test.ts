import { describe, expect, it } from 'vitest';
import type { Character, ClearRecord, Friend } from '@/core/types';
import { candidateCounts, chipToggleDifficulty, raidChips, withTargetDifficulty } from '@/lib/view-model';

const ch = (name: string, itemLevel: number, role: 'dealer' | 'support' = 'dealer'): Character =>
  ({ name, className: '버서커', role, itemLevel, combatPower: 2500 });

const friend = (id: string, characters: Character[], extra: Partial<Friend> = {}): Friend =>
  ({ id, displayName: id, representativeName: characters[0]?.name ?? 'x', characters, ...extra });

describe('raidChips (캐릭터 카드의 레이드 칩)', () => {
  it('그 레이드 이름의 가장 낮은 입장 레벨 이상인 레이드만, 설정 순서로', () => {
    const f = friend('f1', [ch('가나', 1715)]);
    expect(raidChips(f, f.characters[0], []).map((c) => c.raidName)).toEqual([
      '카제로스 3막 (모르둠)', '카제로스 4막 (아르모체)', '지평의 성당', '카제로스 종막 (카제로스)', '세르카',
    ]);
    const high = friend('f1', [ch('나', 1750)]);
    expect(raidChips(high, high.characters[0], []).map((c) => c.raidName)).toContain('벨가르딘');
  });

  it('보이는 난이도: 자동 기본값, 직접 정한 값, 안 감', () => {
    const f = friend('f1', [ch('가나', 1735)], {
      targetDifficulty: { '가나|세르카': '노말', '가나|지평의 성당': '안 감' },
    });
    const chips = raidChips(f, f.characters[0], []);
    const by = (n: string) => chips.find((c) => c.raidName === n)!;
    expect(by('카제로스 4막 (아르모체)')).toMatchObject({ auto: '하드', target: '하드', override: undefined, shown: '하드', cleared: '' });
    expect(by('세르카')).toMatchObject({ auto: '하드', target: '노말', override: '노말', shown: '노말' });
    expect(by('지평의 성당')).toMatchObject({ auto: '2단계', target: null, override: '안 감', shown: '안 감' });
    // 레벨이 되는 난이도만 고를 수 있다
    expect(by('세르카').options).toEqual(['노말', '하드']);
    expect(by('지평의 성당').options).toEqual(['1단계', '2단계']);
  });

  it('클리어했으면 실제로 간 난이도를 보여 준다 (가는 난이도와 달라도)', () => {
    const f = friend('f1', [ch('가나', 1735)]);
    const clears: ClearRecord[] = [{ characterName: '가나', raidName: '세르카', difficulty: '노말' }];
    const serka = raidChips(f, f.characters[0], clears).find((c) => c.raidName === '세르카')!;
    expect(serka).toMatchObject({ target: '하드', cleared: '노말', shown: '노말' });
  });

  it('숙련도: 정한 값만 담는다', () => {
    const f = friend('f1', [ch('가나', 1735)], { proficiency: { '가나|세르카': '숙련' } });
    const chips = raidChips(f, f.characters[0], []);
    expect(chips.find((c) => c.raidName === '세르카')!.proficiency).toBe('숙련');
    expect(chips.find((c) => c.raidName === '지평의 성당')!.proficiency).toBeUndefined();
  });

  it('한 번 누르기: 안 갔으면 가는 난이도로, 갔으면(어느 난이도든) 해제, 안 감이면 아무 것도 안 한다', () => {
    const f = friend('f1', [ch('가나', 1735)], { targetDifficulty: { '가나|지평의 성당': '안 감' } });
    const clears: ClearRecord[] = [{ characterName: '가나', raidName: '세르카', difficulty: '노말' }];
    const chips = raidChips(f, f.characters[0], clears);
    expect(chipToggleDifficulty(chips.find((c) => c.raidName === '세르카')!)).toBe('');
    expect(chipToggleDifficulty(chips.find((c) => c.raidName === '카제로스 4막 (아르모체)')!)).toBe('하드');
    expect(chipToggleDifficulty(chips.find((c) => c.raidName === '지평의 성당')!)).toBeNull();
  });
});

describe('withTargetDifficulty', () => {
  it('정하면 넣고 null이면 지운다 (원본은 그대로)', () => {
    const list = [friend('f1', [ch('가나', 1735)]), friend('f2', [ch('다라', 1735)])];
    const a = withTargetDifficulty(list, 'f1', '가나', '세르카', '노말');
    expect(a[0].targetDifficulty).toEqual({ '가나|세르카': '노말' });
    expect(a[1]).toBe(list[1]);
    expect(list[0].targetDifficulty).toBeUndefined();
    const b = withTargetDifficulty(a, 'f1', '가나', '세르카', null);
    expect(b[0].targetDifficulty).toBeUndefined();
  });
});

describe('candidateCounts (레이드 고르기 칩의 후보 수)', () => {
  const friends = [
    friend('f1', [ch('가나', 1735), ch('가나둘', 1715), ch('낮음', 1690)]),
    friend('f2', [ch('다라', 1745)], { targetDifficulty: { '다라|세르카': '하드' } }),
  ];
  it('참석자의 보이는 캐릭터 중 편성 자격(레벨, 미클리어, 가는 난이도)을 통과한 수', () => {
    const counts = candidateCounts(friends, ['f1', 'f2'], []);
    expect(counts['serka-hard']).toBe(2); // 가나(자동 하드) + 다라(직접 하드)
    expect(counts['serka-normal']).toBe(1); // 가나둘
    expect(counts['serka-nightmare']).toBe(0); // 다라는 하드로 간다
    expect(counts['cathedral-1']).toBe(1); // 가나둘(1715 → 1단계), 1700 미만은 세지 않는다
  });
  it('클리어한 캐릭터와 빠진 친구는 세지 않는다', () => {
    const clears: ClearRecord[] = [{ characterName: '가나', raidName: '세르카', difficulty: '노말' }];
    expect(candidateCounts(friends, ['f1', 'f2'], clears)['serka-hard']).toBe(1);
    expect(candidateCounts(friends, ['f1'], [])['serka-hard']).toBe(1);
    expect(candidateCounts(friends, [], [])['serka-hard']).toBe(0);
  });
});
