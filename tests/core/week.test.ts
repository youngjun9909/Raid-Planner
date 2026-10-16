import { describe, it, expect } from 'vitest';
import { weekKey } from '@/core/week';

describe('weekKey', () => {
  it('수요일 05:59 KST는 전주 키', () => expect(weekKey(new Date('2026-10-14T05:59:00+09:00'))).toBe('2026-10-07'));
  it('수요일 06:00 KST부터 새 키', () => expect(weekKey(new Date('2026-10-14T06:00:00+09:00'))).toBe('2026-10-14'));
  it('금요일은 같은 주 키', () => expect(weekKey(new Date('2026-10-16T12:00:00+09:00'))).toBe('2026-10-14'));
  it('UTC 입력도 KST 기준으로 계산', () => expect(weekKey(new Date('2026-10-13T21:00:00Z'))).toBe('2026-10-14'));
});
