import { describe, expect, it } from 'vitest';
import type { ClearRecord } from '@/core/types';
import {
  RAID_GROUPS,
  RAID_NAMES,
  clearValue,
  planSummaryText,
  formatCP,
  recordsAfterChange,
  TIER_META,
} from '@/lib/view-model';

const clears: ClearRecord[] = [
  { characterName: '가나', raidName: '세르카', difficulty: '노말' },
  { characterName: '가나', raidName: '벨가르딘', difficulty: '하드' },
  { characterName: '다라', raidName: '세르카', difficulty: '하드' },
];

describe('RAID_NAMES / RAID_GROUPS', () => {
  it('lists each raid name once in config order with its difficulties', () => {
    expect(RAID_NAMES).toEqual([
      '카제로스 3막 (모르둠)',
      '카제로스 4막 (아르모체)',
      '지평의 성당',
      '카제로스 종막 (카제로스)',
      '세르카',
      '벨가르딘',
    ]);
    const serka = RAID_GROUPS.find((g) => g.name === '세르카');
    expect(serka?.raids.map((r) => r.difficulty)).toEqual(['노말', '하드', '나이트메어']);
  });
});

describe('clearValue', () => {
  it('returns the cleared difficulty for the character and raid name', () => {
    expect(clearValue(clears, '가나', '세르카')).toBe('노말');
    expect(clearValue(clears, '다라', '세르카')).toBe('하드');
  });
  it('returns empty string when not cleared', () => {
    expect(clearValue(clears, '가나', '지평의 성당')).toBe('');
    expect(clearValue(clears, '없음', '세르카')).toBe('');
  });
});

describe('recordsAfterChange', () => {
  it('adds a new raid while keeping the character’s other records', () => {
    expect(recordsAfterChange(clears, '가나', '지평의 성당', '1단계')).toEqual([
      { raidName: '세르카', difficulty: '노말' },
      { raidName: '벨가르딘', difficulty: '하드' },
      { raidName: '지평의 성당', difficulty: '1단계' },
    ]);
  });
  it('replaces the difficulty of the same raid instead of adding a second', () => {
    expect(recordsAfterChange(clears, '가나', '세르카', '하드')).toEqual([
      { raidName: '세르카', difficulty: '하드' },
      { raidName: '벨가르딘', difficulty: '하드' },
    ]);
  });
  it('removes the raid when set to empty (안 감)', () => {
    expect(recordsAfterChange(clears, '가나', '세르카', '')).toEqual([{ raidName: '벨가르딘', difficulty: '하드' }]);
  });
  it('ignores other characters’ records', () => {
    expect(recordsAfterChange(clears, '다라', '세르카', '')).toEqual([]);
  });
});

describe('formatting helpers', () => {
  it('formats combat power with thousands separators', () => {
    expect(formatCP(2450.4)).toBe('2,450');
    expect(formatCP(null)).toBe('—');
  });
  it('summarises a recommendation in one line (외부 0이면 친구들만으로 구성 가능)', () => {
    const base = { friendCount: 2, characterCount: 3, partyCount: 2 };
    expect(planSummaryText({ ...base, externalCount: 5, externalSupports: 2, externalDealers: 3 }))
      .toBe('친구 2명 · 캐릭터 3개 · 공대 2개 · 외부 5명 필요 (서포터 2, 딜러 3)');
    expect(planSummaryText({ ...base, externalCount: 1, externalSupports: 0, externalDealers: 1 }))
      .toBe('친구 2명 · 캐릭터 3개 · 공대 2개 · 외부 1명 필요 (서포터 0, 딜러 1)');
    expect(planSummaryText({ ...base, externalCount: 0, externalSupports: 0, externalDealers: 0 }))
      .toBe('친구 2명 · 캐릭터 3개 · 공대 2개 · 친구들만으로 구성 가능');
  });
  it('has a Korean label and an icon for every tier', () => {
    expect(TIER_META.comfortable.label).toBe('여유');
    expect(TIER_META.tight.label).toBe('빠듯함');
    expect(TIER_META.risky.label).toBe('위험');
    expect(TIER_META.unknown.label).toBe('모름');
    for (const t of Object.values(TIER_META)) expect(t.icon).toBeTruthy();
  });
});
