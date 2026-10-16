import { describe, it, expect } from 'vitest';
import {
  autoDifficulty, difficultiesOf, effectiveDifficulty, isTargetDifficultyFor, isTargetEligible, SKIP_DIFFICULTY,
  targetDifficultyLookup, TARGET_RAID_NAMES,
} from '@/core/difficulty';
import { getRaid, MIN_RAID_LEVEL } from '@/core/raids';
import type { Friend } from '@/core/types';

const ARMOCHE = '카제로스 4막 (아르모체)';
const CATHEDRAL = '지평의 성당';

describe('autoDifficulty (자동 기본값 = 입장 가능한 가장 높은 난이도)', () => {
  it('1720 → 카제로스 4막 하드, 1705 → 노말, 1699 → 없음', () => {
    expect(autoDifficulty(1720, ARMOCHE)).toBe('하드');
    expect(autoDifficulty(1705, ARMOCHE)).toBe('노말');
    expect(autoDifficulty(1699, ARMOCHE)).toBeNull();
  });
  it('지평의 성당: 1735 → 2단계, 1700 → 1단계, 1750 → 3단계, 1699 → 없음', () => {
    expect(autoDifficulty(1735, CATHEDRAL)).toBe('2단계');
    expect(autoDifficulty(1700, CATHEDRAL)).toBe('1단계');
    expect(autoDifficulty(1750, CATHEDRAL)).toBe('3단계');
    expect(autoDifficulty(1699, CATHEDRAL)).toBeNull();
  });
  it('세르카: 1740 → 나이트메어, 1730 → 하드, 1710 → 노말', () => {
    expect(autoDifficulty(1740, '세르카')).toBe('나이트메어');
    expect(autoDifficulty(1739.99, '세르카')).toBe('하드');
    expect(autoDifficulty(1710, '세르카')).toBe('노말');
  });
  it('모르는 레이드 이름 → null', () => expect(autoDifficulty(1800, '없는 레이드')).toBeNull());
});

describe('effectiveDifficulty', () => {
  it('정하지 않으면 자동, 정했으면 그 값, 안 감이면 null', () => {
    expect(effectiveDifficulty(1720, ARMOCHE, undefined)).toBe('하드');
    expect(effectiveDifficulty(1720, ARMOCHE, '노말')).toBe('노말');
    expect(effectiveDifficulty(1720, ARMOCHE, SKIP_DIFFICULTY)).toBeNull();
    expect(SKIP_DIFFICULTY).toBe('안 감');
  });
  it('레벨보다 높은 난이도를 정해도 값은 그대로 (자격은 레벨 규칙이 막는다)', () => {
    expect(effectiveDifficulty(1705, ARMOCHE, '하드')).toBe('하드');
  });
});

describe('isTargetEligible (편성 자격의 난이도 부분)', () => {
  const normal = getRaid('armoche-normal')!;
  const hard = getRaid('armoche-hard')!;
  it('1720 캐릭터: 4막 하드에는 후보, 노말에는 아님', () => {
    expect(isTargetEligible(1720, hard, undefined)).toBe(true);
    expect(isTargetEligible(1720, normal, undefined)).toBe(false);
  });
  it('1705 캐릭터: 4막 노말에만 후보', () => {
    expect(isTargetEligible(1705, normal, undefined)).toBe(true);
    expect(isTargetEligible(1705, hard, undefined)).toBe(false);
  });
  it('1720 캐릭터에 노말을 정하면 노말에만, 안 감이면 어디에도 없다', () => {
    expect(isTargetEligible(1720, normal, '노말')).toBe(true);
    expect(isTargetEligible(1720, hard, '노말')).toBe(false);
    expect(isTargetEligible(1720, normal, SKIP_DIFFICULTY)).toBe(false);
    expect(isTargetEligible(1720, hard, SKIP_DIFFICULTY)).toBe(false);
  });
  it('레벨보다 높은 난이도를 정하면 그 레이드에 후보가 아니다 (레벨 규칙이 이긴다)', () => {
    expect(isTargetEligible(1705, hard, '하드')).toBe(false);
    expect(isTargetEligible(1705, normal, '하드')).toBe(false);
  });
});

describe('난이도 값 검사와 조회', () => {
  it('difficultiesOf: 입장 레벨 순서', () => {
    expect(difficultiesOf(CATHEDRAL)).toEqual(['1단계', '2단계', '3단계']);
    expect(difficultiesOf('없는 레이드')).toEqual([]);
  });
  it('isTargetDifficultyFor: 그 레이드 이름의 난이도 또는 안 감만', () => {
    expect(isTargetDifficultyFor(ARMOCHE, '하드')).toBe(true);
    expect(isTargetDifficultyFor(ARMOCHE, SKIP_DIFFICULTY)).toBe(true);
    expect(isTargetDifficultyFor(ARMOCHE, '3단계')).toBe(false);
    expect(isTargetDifficultyFor('없는 레이드', '하드')).toBe(false);
    expect(isTargetDifficultyFor(ARMOCHE, 1 as unknown)).toBe(false);
  });
  it('TARGET_RAID_NAMES는 레이드 이름 목록 (설정 순서, 중복 없음)', () => {
    expect(TARGET_RAID_NAMES).toContain(ARMOCHE);
    expect(new Set(TARGET_RAID_NAMES).size).toBe(TARGET_RAID_NAMES.length);
  });
  it('targetDifficultyLookup: 친구가 정한 값(그 레이드 이름)만 돌려준다', () => {
    const fs: Friend[] = [{ id: 'a', displayName: 'A', representativeName: 'x', characters: [], targetDifficulty: { [`x|${ARMOCHE}`]: '노말', 'x|세르카': SKIP_DIFFICULTY } }];
    const look = targetDifficultyLookup(fs, ARMOCHE);
    expect(look('a', 'x')).toBe('노말');
    expect(look('a', 'y')).toBeUndefined();
    expect(look('b', 'x')).toBeUndefined();
    expect(targetDifficultyLookup(fs, '세르카')('a', 'x')).toBe(SKIP_DIFFICULTY);
  });
  it('MIN_RAID_LEVEL은 RAIDS에서 나온다 (1700)', () => expect(MIN_RAID_LEVEL).toBe(1700));
});
