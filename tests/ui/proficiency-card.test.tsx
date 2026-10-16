// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CandidateCard } from '@/components/CandidateCard';
import type { Candidate, Friend, Party, Proficiency, Role, Slot } from '@/core/types';
import { summarizeProficiency } from '@/core/proficiency';

afterEach(cleanup);

const fs = (name: string, role: Role, cp: number | null, proficiency?: Proficiency, friendId = 'f1'): Slot => ({
  kind: 'friend', friendId, character: { name, className: 'x', role, itemLevel: 1730, combatPower: cp }, ...(proficiency ? { proficiency } : {}),
});
const ext = (role: Role): Slot => ({ kind: 'external', role });
const friends: Friend[] = [
  { id: 'f1', displayName: '영준', representativeName: 'a', characters: [] },
  { id: 'f2', displayName: '민수', representativeName: 'b', characters: [] },
];
const party = (slots: Slot[], withSummary = true): Party =>
  ({ slots, dealerAvgCP: 2000, tier: 'comfortable', ...(withSummary ? { proficiency: summarizeProficiency(slots) } : {}) });
const cand = (parties: Party[]): Candidate => ({
  parties,
  summary: { friendCount: 2, characterCount: 4, partyCount: parties.length, externalCount: 0, externalSupports: 0, externalDealers: 0, friendThreshold: 1 },
  kind: 'recommended', imbalance: 0, unplaced: [],
});

describe('추천 카드의 숙련도', () => {
  const p1 = party([fs('딜1', 'dealer', 2500, '숙련'), fs('딜2', 'dealer', 2400, '클경', 'f2'), ext('dealer'), fs('서폿', 'support', null, '반숙', 'f2')]);
  const p2 = party([fs('딜3', 'dealer', 2300, '반숙'), fs('딜4', 'dealer', 2200, '클경', 'f2'), ext('dealer'), ext('support')]);

  it('구성원 줄마다 숙련도 배지(모양 아이콘 + 글자), 외부 자리에는 없다', () => {
    render(<CandidateCard candidate={cand([p1, p2])} rank={0} friends={friends} raidId="serka-hard" proficiencyTracked />);
    const r1 = screen.getByRole('region', { name: '추천 1 1공대' });
    const row = (name: string) => within(r1).getByText(name).closest('li')!;
    expect(within(row('딜1')).getByText('숙련')).toHaveClass('prof__label');
    expect(row('딜1').querySelector('.prof--expert')).toHaveTextContent('●숙련');
    expect(row('딜2').querySelector('.prof--novice')).toHaveTextContent('○클경');
    expect(row('서폿').querySelector('.prof--mid')).toHaveTextContent('◐반숙');
    const external = within(r1).getByText('외부 딜러').closest('li')!;
    expect(external.querySelector('.prof')).toBeNull();
    // 배지는 접근성 이름을 가진다
    expect(within(row('딜1')).getByTitle('숙련도: 숙련')).toBeInTheDocument();
  });

  it('공대 머리에 "숙련 1 · 반숙 1 · 클경 1" 요약, 숙련자가 없는 공대에만 "숙련자 없음" 경고', () => {
    render(<CandidateCard candidate={cand([p1, p2])} rank={0} friends={friends} raidId="serka-hard" proficiencyTracked />);
    const r1 = screen.getByRole('region', { name: '추천 1 1공대' });
    const r2 = screen.getByRole('region', { name: '추천 1 2공대' });
    expect(within(r1).getByText('숙련 1 · 반숙 1 · 클경 1')).toBeInTheDocument();
    expect(within(r1).queryByText('숙련자 없음')).toBeNull();
    expect(within(r2).getByText('숙련 0 · 반숙 1 · 클경 1')).toBeInTheDocument();
    const warn = within(r2).getByText('숙련자 없음').closest('.prof-warn')!;
    expect(warn).toHaveTextContent('⚠숙련자 없음');
    expect(warn.querySelector('[aria-hidden="true"]')).toHaveTextContent('⚠');
  });

  it('숙련도를 아무도 정하지 않았으면(추적 안 함) 요약은 보이지만 경고와 기본 반숙 배지는 없다 (예전 응답도 같음)', () => {
    const plain = party([fs('딜1', 'dealer', 2500), fs('딜2', 'dealer', 2400, '반숙', 'f2'), ext('support')]);
    for (const cardParty of [plain, party([fs('딜1', 'dealer', 2500), ext('support')], false)]) {
      const { unmount } = render(<CandidateCard candidate={cand([cardParty])} rank={0} friends={friends} raidId="serka-hard" />);
      const r = screen.getByRole('region', { name: '추천 1 1공대' });
      expect(within(r).getByText(/^숙련 0 · 반숙 \d · 클경 0$/)).toBeInTheDocument();
      expect(within(r).queryByText('숙련자 없음')).toBeNull();
      expect(r.querySelector('.prof')).toBeNull();
      unmount();
    }
  });

  it('추적 중이 아니어도 숙련/클경 값은 배지를 보여 준다 (기본 반숙만 숨김)', () => {
    render(<CandidateCard candidate={cand([party([fs('딜1', 'dealer', 2500, '숙련'), fs('딜2', 'dealer', 2400, '클경', 'f2'), fs('딜3', 'dealer', 2400, '반숙')])])} rank={0} friends={friends} raidId="serka-hard" />);
    const r = screen.getByRole('region', { name: '추천 1 1공대' });
    expect(r.querySelectorAll('.prof--expert')).toHaveLength(1);
    expect(r.querySelectorAll('.prof--novice')).toHaveLength(1);
    expect(r.querySelectorAll('.prof--mid')).toHaveLength(0);
  });

  it('추적 중이면 모두 클경인 공대에도 "숙련자 없음" 경고', () => {
    render(<CandidateCard candidate={cand([party([fs('딜1', 'dealer', 2500, '클경'), fs('딜2', 'dealer', 2400, '클경', 'f2')])])} rank={0} friends={friends} raidId="serka-hard" proficiencyTracked />);
    const r = screen.getByRole('region', { name: '추천 1 1공대' });
    expect(within(r).getByText('숙련자 없음')).toBeInTheDocument();
    expect(within(r).getByText('숙련 0 · 반숙 0 · 클경 2')).toBeInTheDocument();
  });

  it('배지를 넣어도 표시 순서(딜러 → 서포터)와 3열 그리드 구조는 그대로', () => {
    const { container } = render(<CandidateCard candidate={cand([p1, p2, p2])} rank={0} friends={friends} raidId="serka-hard" />);
    const grid = container.querySelector('.candidate__parties')!;
    expect(within(grid as HTMLElement).getAllByRole('region')).toHaveLength(3);
    const rows = within(screen.getByRole('region', { name: '추천 1 1공대' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('딜1');
    expect(rows[rows.length - 1]).toHaveTextContent('서폿');
  });
});
