import { describe, it, expect } from 'vitest';
import { RAIDS, getRaid } from '@/core/raids';

describe('raids', () => {
  it('스펙의 14개 레이드가 있다', () => expect(RAIDS).toHaveLength(14));
  it('세르카 하드는 4인, 1730, 권장 3600~4000', () => {
    expect(getRaid('serka-hard')).toMatchObject({ size: 4, minLevel: 1730, recommendedCP: { min: 3600, max: 4000 } });
  });
  it('벨가르딘 나이트메어는 8인, 1780, 최대 없음', () => {
    expect(getRaid('belgardin-nightmare')).toMatchObject({ size: 8, minLevel: 1780, recommendedCP: { min: 7000, max: null } });
  });
  it('4인은 세르카·지평의 성당뿐, 나머지는 8인', () => {
    for (const r of RAIDS) expect(r.size).toBe(['세르카', '지평의 성당'].includes(r.name) ? 4 : 8);
  });
});
