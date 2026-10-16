// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CandidateCard } from '@/components/CandidateCard';
import type { Candidate, Friend, Slot, UnplacedCharacter } from '@/core/types';

afterEach(cleanup);

const fs = (name: string, friendId = 'f1'): Slot => ({
  kind: 'friend', friendId, character: { name, className: 'x', role: 'dealer', itemLevel: 1730, combatPower: 2500 },
});
const friends: Friend[] = [
  { id: 'f1', displayName: '영준', representativeName: 'a', characters: [] },
  { id: 'f2', displayName: '민수', representativeName: 'b', characters: [] },
];
const cand = (unplaced: UnplacedCharacter[], externalCount = 1): Candidate => ({
  parties: [{ slots: [fs('딜1'), fs('딜2', 'f2'), fs('딜3', 'f3'), { kind: 'external', role: 'support' }], dealerAvgCP: 2500, tier: 'comfortable' }],
  summary: {
    friendCount: 3, characterCount: 3, partyCount: 1, externalCount, externalSupports: externalCount, externalDealers: 0, friendThreshold: 3,
  },
  kind: 'recommended',
  imbalance: 0,
  unplaced,
});
const up = (friendId: string, characterName: string): UnplacedCharacter => ({ friendId, characterName });
const UNPLACED_TITLE = '이번에 못 간 캐릭터';

describe('추천 카드: 이번에 못 간 캐릭터', () => {
  it('못 간 캐릭터가 없으면 아무 것도 그리지 않는다', () => {
    render(<CandidateCard candidate={cand([])} rank={0} friends={friends} raidId="serka-hard" />);
    expect(screen.queryByText(UNPLACED_TITLE)).toBeNull();
    expect(screen.queryByText(/외부인이 많이 필요해서/)).toBeNull();
  });

  it('공대 아래에 친구별로 묶어 "<친구> <캐릭터>"로 보여 주고 짧은 설명을 붙인다', () => {
    render(<CandidateCard candidate={cand([up('f1', '가나'), up('f2', '다라'), up('f1', '가나서폿')])} rank={0} friends={friends} raidId="serka-hard" />);
    const box = screen.getByRole('group', { name: '추천 1 이번에 못 간 캐릭터' });
    expect(within(box).getByText(UNPLACED_TITLE)).toBeInTheDocument();
    expect(within(box).getByText('(외부인이 많이 필요해서 이번 추천에서 뺐어요)')).toHaveClass('muted');
    const rows = within(box).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['영준 가나, 가나서폿', '민수 다라']); // 처음 나온 친구 순서, 친구 안에서는 받은 순서
    // 공대 그리드 다음에 온다 (공대 영역 수는 그대로)
    const grid = document.querySelector('.candidate__parties')!;
    expect(grid.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('모르는 친구 id는 "알 수 없음"으로', () => {
    render(<CandidateCard candidate={cand([up('ghost', '유령')])} rank={0} friends={friends} raidId="serka-hard" />);
    expect(within(screen.getByRole('group', { name: '추천 1 이번에 못 간 캐릭터' })).getByRole('listitem')).toHaveTextContent('알 수 없음 유령');
  });

  it('길면 처음 8개만 보이고 "외 N개 더 보기"로 펼치고 접는다 (버튼, aria-expanded)', () => {
    const many = [
      ...Array.from({ length: 6 }, (_, i) => up('f1', `영${i + 1}`)),
      ...Array.from({ length: 5 }, (_, i) => up('f2', `민${i + 1}`)),
    ];
    render(<CandidateCard candidate={cand(many)} rank={1} friends={friends} raidId="serka-hard" />);
    const box = screen.getByRole('group', { name: '추천 2 이번에 못 간 캐릭터' });
    expect(within(box).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['영준 영1, 영2, 영3, 영4, 영5, 영6', '민수 민1, 민2']);
    const more = within(box).getByRole('button', { name: '외 3개 더 보기' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(within(box).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['영준 영1, 영2, 영3, 영4, 영5, 영6', '민수 민1, 민2, 민3, 민4, 민5']);
    const less = within(box).getByRole('button', { name: '접기' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(less);
    expect(within(box).getAllByRole('listitem')).toHaveLength(2);
    expect(within(box).getByRole('button', { name: '외 3개 더 보기' })).toBeInTheDocument();
  });

  it('8개 이하면 펼치기 버튼이 없다', () => {
    render(<CandidateCard candidate={cand(Array.from({ length: 8 }, (_, i) => up('f1', `c${i}`)))} rank={0} friends={friends} raidId="serka-hard" />);
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull();
  });

  it('요약 문구: "친구 N명 · 캐릭터 M개 편성 · 공대 P개 · 외부 E명 필요 (서포터 a, 딜러 b)" / "친구들만으로 구성 가능"', () => {
    const { unmount } = render(<CandidateCard candidate={cand([up('f1', '가나')])} rank={0} friends={friends} raidId="serka-hard" />);
    expect(screen.getByText('친구 3명 · 캐릭터 3개 편성 · 공대 1개 · 외부 1명 필요 (서포터 1, 딜러 0)')).toBeInTheDocument();
    unmount();
    render(<CandidateCard candidate={cand([], 0)} rank={0} friends={friends} raidId="serka-hard" />);
    expect(screen.getByText('친구 3명 · 캐릭터 3개 편성 · 공대 1개 · 친구들만으로 구성 가능')).toBeInTheDocument();
  });
});
