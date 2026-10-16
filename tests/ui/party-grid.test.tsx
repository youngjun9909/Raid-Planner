// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CandidateCard } from '@/components/CandidateCard';
import type { Candidate, Friend, Party, Role, Slot } from '@/core/types';

afterEach(cleanup);

const fs = (name: string, role: Role, cp: number | null): Slot => ({
  kind: 'friend', friendId: 'f1', character: { name, className: 'x', role, itemLevel: 1730, combatPower: cp },
});
const friends: Friend[] = [{ id: 'f1', displayName: '영준', representativeName: 'a', characters: [] }];
const party = (slots: Slot[], tier: Party['tier'] = 'comfortable'): Party => ({ slots, dealerAvgCP: 2000, tier });
const cand = (parties: Party[]): Candidate => ({
  parties,
  summary: { friendCount: 1, characterCount: 1, partyCount: parties.length, externalCount: 0, externalSupports: 0, externalDealers: 0, friendThreshold: 1 },
  kind: 'recommended', imbalance: 0, unplaced: [],
});
const four = [fs('딜1', 'dealer', 2500), fs('서폿', 'support', null), { kind: 'external', role: 'dealer' } as Slot, { kind: 'external', role: 'dealer' } as Slot];

describe('추천 카드 공대 그리드', () => {
  it('공대들이 하나의 그리드 컨테이너 안에 들어 있고 추천마다 이름이 있다', () => {
    const { container } = render(<CandidateCard candidate={cand([party(four), party(four, 'tight'), party(four, 'risky')])} rank={1} friends={friends} raidId="serka-hard" />);
    const grid = container.querySelector('.candidate__parties') as HTMLElement;
    expect(grid).toHaveAttribute('role', 'group');
    expect(grid).toHaveAccessibleName('추천 2 공대 목록');
    expect(within(grid).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['추천 2 1공대', '추천 2 2공대', '추천 2 3공대']);
  });

  it('각 공대에 레벨·전투력 열 이름이 글자로 한 번씩 있다', () => {
    render(<CandidateCard candidate={cand([party(four), party(four)])} rank={0} friends={friends} raidId="serka-hard" />);
    for (const r of screen.getAllByRole('region')) {
      expect(within(r).getAllByText('레벨')).toHaveLength(1);
      expect(within(r).getAllByText('전투력')).toHaveLength(1);
    }
  });

  it('8인 공대도 열 이름은 공대당 한 번이고 숫자·순서·구분선은 그대로다', () => {
    const eight = [fs('서1', 'support', null), ...[1, 2, 3, 4, 5, 6].map((i) => fs(`딜${i}`, 'dealer', i * 100)), { kind: 'external', role: 'support' } as Slot];
    render(<CandidateCard candidate={cand([party(eight)])} rank={0} friends={friends} raidId="kazeros-hard" />);
    const r = screen.getByRole('region', { name: '추천 1 1공대' });
    expect(within(r).getAllByText('레벨')).toHaveLength(1);
    expect(within(r).getAllByRole('list')).toHaveLength(2);
    expect(within(r).getAllByRole('separator')).toHaveLength(1);
    expect(within(r).getByText('600')).toBeInTheDocument();
    expect(within(r).getAllByText('1730').length).toBeGreaterThan(0);
  });

  it('숫자 값, 티어 아이콘+글자, 외부 슬롯이 유지된다', () => {
    render(<CandidateCard candidate={cand([party(four)])} rank={0} friends={friends} raidId="serka-hard" />);
    const r = screen.getByRole('region', { name: '추천 1 1공대' });
    expect(within(r).getByText('2,500')).toBeInTheDocument();
    expect(within(r).getByText('여유')).toBeInTheDocument();
    expect(within(r).getAllByText('외부 딜러')).toHaveLength(2);
    const rows = within(within(r).getByRole('list')).getAllByRole('listitem');
    expect(rows[rows.length - 1]).toHaveTextContent('서폿');
  });
});
