// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CandidateCard } from '@/components/CandidateCard';
import type { Candidate, Friend, Role, Slot } from '@/core/types';

afterEach(cleanup);

const fs = (name: string, role: Role, cp: number | null): Slot => ({
  kind: 'friend', friendId: 'f1', character: { name, className: 'x', role, itemLevel: 1730, combatPower: cp },
});
const friends: Friend[] = [{ id: 'f1', displayName: '영준', representativeName: 'a', characters: [] }];
const cand = (slots: Slot[]): Candidate => ({
  parties: [{ slots, dealerAvgCP: 1000, tier: 'comfortable' }],
  summary: { friendCount: 1, characterCount: slots.length, partyCount: 1, externalCount: 0, externalSupports: 0, externalDealers: 0, friendThreshold: 1 },
  kind: 'recommended', imbalance: 0, unplaced: [],
});
const rowNames = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.textContent ?? '');

describe('CandidateCard 표시 순서', () => {
  it('4인: 서포터가 중간에 있어도 맨 아래에 나온다', () => {
    render(<CandidateCard candidate={cand([fs('딜1', 'dealer', 100), fs('서폿', 'support', null), fs('딜2', 'dealer', 300), fs('딜3', 'dealer', 200)])} rank={0} friends={friends} raidId="serka-hard" />);
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(1);
    const rows = rowNames(lists[0]);
    expect(rows[0]).toContain('딜2');
    expect(rows[3]).toContain('서폿');
    expect(screen.queryByRole('separator')).toBeNull();
  });
  it('8인: 두 덩어리 사이에 구분선, 각 덩어리의 마지막 줄이 서포터', () => {
    const slots = [fs('서1', 'support', null), ...[1, 2, 3, 4, 5, 6].map((i) => fs(`딜${i}`, 'dealer', i * 100)), { kind: 'external', role: 'support' } as Slot];
    render(<CandidateCard candidate={cand(slots)} rank={0} friends={friends} raidId="kazeros-hard" />);
    const a = screen.getByRole('list', { name: '추천 1 1공대 4인 파티 A' });
    const b = screen.getByRole('list', { name: '추천 1 1공대 4인 파티 B' });
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    const ra = rowNames(a);
    const rb = rowNames(b);
    expect(ra).toHaveLength(4);
    expect(rb).toHaveLength(4);
    expect(ra[3]).toContain('서1');
    expect(rb[3]).toContain('외부 서포터');
    expect(ra[0]).toContain('딜6');
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
