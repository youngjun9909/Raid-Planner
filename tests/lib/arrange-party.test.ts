import { describe, expect, it } from 'vitest';
import { arrangeParty } from '@/lib/arrange-party';
import type { Party, Role, Slot } from '@/core/types';

const f = (name: string, role: Role, itemLevel: number, combatPower: number | null): Slot => ({
  kind: 'friend', friendId: `f-${name}`,
  character: { name, className: 'x', role, itemLevel, combatPower },
});
const ext = (role: Role): Slot => ({ kind: 'external', role });
const party = (slots: Slot[]): Party => ({ slots, dealerAvgCP: null, tier: 'unknown' });
const label = (s: Slot) => (s.kind === 'external' ? `ext-${s.role}` : s.character.name);
const names = (blocks: Slot[][]) => blocks.map((b) => b.map(label));
const cp = (s: Slot) => (s.kind === 'friend' ? s.character.combatPower ?? 0 : 0);

describe('arrangeParty', () => {
  it('4인: 딜러 3명 먼저, 서포터는 맨 아래', () => {
    const p = party([f('d1', 'dealer', 1700, 3000), f('s', 'support', 1710, null), f('d2', 'dealer', 1700, 5000), f('d3', 'dealer', 1700, 4000)]);
    expect(names(arrangeParty(p, 4))).toEqual([['d2', 'd3', 'd1', 's']]);
  });
  it('4인 + 외부: 외부 딜러는 딜러 끝, 외부 서포터는 맨 아래', () => {
    const p = party([ext('support'), ext('dealer'), f('d1', 'dealer', 1700, 3000), f('d2', 'dealer', 1700, 5000)]);
    expect(names(arrangeParty(p, 4))).toEqual([['d2', 'd1', 'ext-dealer', 'ext-support']]);
  });
  it('전투력 모르는 딜러는 값 있는 딜러 뒤, 템렙 높은 순', () => {
    const p = party([f('n1', 'dealer', 1690, null), f('d1', 'dealer', 1600, 100), f('n2', 'dealer', 1720, null), f('s', 'support', 1700, null)]);
    expect(names(arrangeParty(p, 4))[0]).toEqual(['d1', 'n2', 'n1', 's']);
  });
  it('8인: 두 덩어리, 각각 딜러 3 + 서포터 1', () => {
    const slots = [1, 2, 3, 4, 5, 6].map((i) => f(`d${i}`, 'dealer', 1700, i * 1000))
      .concat([f('s1', 'support', 1700, null), f('s2', 'support', 1710, null)]);
    const blocks = arrangeParty(party(slots), 8);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      expect(b).toHaveLength(4);
      expect(label(b[3])).toMatch(/^s/);
      expect(b.slice(0, 3).every((s) => label(s).startsWith('d'))).toBe(true);
    }
    expect(label(blocks[0][3])).toBe('s2'); // 템렙 높은 서포터가 A
  });
  it('8인 뱀 순서로 합이 비슷하다', () => {
    const slots = [6000, 5000, 4000, 3000, 2000, 1000].map((c, i) => f(`d${i}`, 'dealer', 1700, c))
      .concat([ext('support'), ext('support')]);
    const [a, b] = arrangeParty(party(slots), 8);
    const sum = (blk: Slot[]) => blk.reduce((t, s) => t + cp(s), 0);
    expect(sum(a)).toBe(6000 + 3000 + 2000);
    expect(sum(b)).toBe(5000 + 4000 + 1000);
    expect(Math.abs(sum(a) - sum(b))).toBeLessThanOrEqual(1000);
    expect(a.slice(0, 3).map(cp)).toEqual([6000, 3000, 2000]); // 덩어리 안 내림차순
  });
  it('8인: 친구 서포터 1명이면 A, 외부 서포터는 B', () => {
    const slots = [...[1, 2, 3, 4, 5, 6].map((i) => f(`d${i}`, 'dealer', 1700, i)), ext('support'), f('s', 'support', 1700, null)];
    const [a, b] = arrangeParty(party(slots), 8);
    expect(label(a[3])).toBe('s');
    expect(label(b[3])).toBe('ext-support');
  });
  it('8인: 외부 딜러는 각 덩어리 딜러 끝', () => {
    const slots = [f('d1', 'dealer', 1700, 9), f('d2', 'dealer', 1700, 8), ext('dealer'), ext('dealer'), f('d3', 'dealer', 1700, 7), f('d4', 'dealer', 1700, 6), f('s1', 'support', 1, null), f('s2', 'support', 1, null)];
    const [a, b] = arrangeParty(party(slots), 8);
    expect(names([a, b])).toEqual([['d1', 'd4', 'ext-dealer', 's1'], ['d2', 'd3', 'ext-dealer', 's2']]);
  });
  it('이상한 구성도 모든 슬롯이 정확히 한 번씩 나온다', () => {
    const cases: [Slot[], number][] = [
      [[f('s1', 'support', 1, null), f('s2', 'support', 2, null), f('s3', 'support', 3, null), f('d', 'dealer', 1, 1)], 4],
      [[f('d1', 'dealer', 1, 1), f('d2', 'dealer', 1, 2), ext('dealer')], 8],
      [[f('s1', 'support', 1, null), f('s2', 'support', 2, null), f('s3', 'support', 3, null), f('d1', 'dealer', 1, 1)], 8],
      [[], 8],
    ];
    for (const [slots, size] of cases) {
      const out = arrangeParty(party(slots), size).flat();
      expect(out).toHaveLength(slots.length);
      for (const s of slots) expect(out.filter((x) => x === s)).toHaveLength(1);
    }
  });
  it('서포터가 남으면 딜러 뒤 각 덩어리 끝에 둔다', () => {
    const slots = [f('d', 'dealer', 1, 1), f('s1', 'support', 3, null), f('s2', 'support', 2, null), f('s3', 'support', 1, null)];
    const blocks = arrangeParty(party(slots), 8);
    expect(names(blocks)).toEqual([['d', 's1', 's3'], ['s2']]);
  });
  it('원본을 바꾸지 않는다', () => {
    const slots = [f('s', 'support', 1, null), f('d1', 'dealer', 1, 1), f('d2', 'dealer', 1, 9)];
    const p = party(slots);
    arrangeParty(p, 4);
    expect(p.slots).toEqual(slots);
    expect(p.slots.map(label)).toEqual(['s', 'd1', 'd2']);
  });
});
