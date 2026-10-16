// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CandidateCard } from '@/components/CandidateCard';
import { PlanBoard } from '@/components/PlanBoard';
import { getRaid } from '@/core/raids';
import type { Candidate, Friend, Slot } from '@/core/types';

afterEach(cleanup);

const fs = (name: string, friendId = 'f1', proficiency?: '숙련' | '반숙' | '클경'): Slot => ({
  kind: 'friend', friendId, proficiency, character: { name, className: 'x', role: 'dealer', itemLevel: 1730, combatPower: 2500 },
});
const friends: Friend[] = [{ id: 'f1', displayName: '영준', representativeName: 'a', characters: [] }];
const cand = (kind: Candidate['kind'], extra: { ext?: number; placed?: number } = {}, unplaced: Candidate['unplaced'] = []): Candidate => ({
  kind,
  parties: [{ slots: [fs('딜1', 'f1', '숙련'), fs('딜2'), fs('딜3'), { kind: 'external', role: 'support' }], dealerAvgCP: 2500, tier: 'risky' }],
  summary: {
    friendCount: 1, characterCount: 3, partyCount: 1, externalCount: 1, externalSupports: 1, externalDealers: 0, friendThreshold: 3,
    ...(kind === 'fullPlacement' ? { extraExternalVsBest: extra.ext, extraPlacedVsBest: extra.placed } : {}),
  },
  imbalance: 0,
  unplaced,
});

describe('모두 편성 대안 카드', () => {
  it('제목은 "모두 편성"(⭐ 없음), 비교 한 줄, 요약, 공대 aria 라벨', () => {
    render(<CandidateCard candidate={cand('fullPlacement', { ext: 3, placed: 2 })} rank={2} number={2} friends={friends} raidId="serka-hard" proficiencyTracked />);
    const card = screen.getByRole('article', { name: '모두 편성' });
    expect(within(card).getByRole('heading', { level: 4 })).toHaveTextContent(/^모두 편성$/);
    expect(card.textContent).not.toContain('⭐');
    expect(card.textContent).not.toContain('가장 좋은 편성');
    expect(card).toHaveClass('candidate--full');
    expect(card.querySelector('.candidate__note')).toHaveTextContent('추천보다 ⚠ 외부 3명 더 필요해요 · 캐릭터 2개 더 편성');
    expect(within(card).getByText(/외부 3명 더 필요해요/)).toHaveClass('candidate__note-ext');
    expect(within(card).getByText(/친구 1명 · 캐릭터 3개 편성/)).toBeInTheDocument();
    expect(within(card).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['모두 편성 1공대']);
    expect(within(card).getByRole('group', { name: '모두 편성 공대 목록' })).toBeInTheDocument();
    // 등급 배지와 숙련도 배지는 그대로
    expect(card.querySelector('.party--risky')).not.toBeNull();
    expect(within(card).getByText('숙련')).toBeInTheDocument();
    expect(card.querySelector('.unplaced')).toBeNull();
  });

  it('숫자가 없거나 0인 부분은 뺀다', () => {
    const { rerender } = render(<CandidateCard candidate={cand('fullPlacement', { ext: 2 })} rank={1} friends={friends} raidId="serka-hard" />);
    expect(document.querySelector('.candidate__note')).toHaveTextContent('추천보다 ⚠ 외부 2명 더 필요해요');
    expect(document.querySelector('.candidate__note')!.textContent).not.toContain('캐릭터');
    rerender(<CandidateCard candidate={cand('fullPlacement', { ext: 0, placed: 4 })} rank={1} friends={friends} raidId="serka-hard" />);
    expect(document.querySelector('.candidate__note')).toHaveTextContent('추천보다 캐릭터 4개 더 편성');
    expect(document.querySelector('.candidate__note')!.textContent).not.toContain('외부');
    rerender(<CandidateCard candidate={cand('fullPlacement', {})} rank={1} friends={friends} raidId="serka-hard" />);
    expect(document.querySelector('.candidate__note')).toBeNull();
  });

  it('추천 카드에는 비교 줄이 없다', () => {
    render(<CandidateCard candidate={cand('recommended')} rank={0} friends={friends} raidId="serka-hard" />);
    expect(document.querySelector('.candidate__note')).toBeNull();
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('추천 1');
  });
});

describe('PlanBoard: 번호는 추천만 센다', () => {
  it('추천 1, 추천 2, 모두 편성 (id 겹침 없음)', () => {
    const data = {
      candidates: [cand('recommended'), cand('recommended'), cand('fullPlacement', { ext: 1, placed: 1 })],
      excluded: [],
      raid: getRaid('serka-hard')!,
    };
    render(<PlanBoard raidIds={['serka-hard']} plans={{ 'serka-hard': { status: 'ready', data } }} friends={friends} hasAttendees />);
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['⭐추천 1', '추천 2', '모두 편성']);
    const ids = Array.from(document.querySelectorAll('h4')).map((h) => h.id);
    expect(new Set(ids).size).toBe(3);
    expect(screen.getByRole('article', { name: /추천 2/ })).toBeInTheDocument();
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label')).filter(Boolean)).toEqual(['추천 1 1공대', '추천 2 1공대', '모두 편성 1공대']);
  });

  it('추천이 하나일 때도 대안은 모두 편성', () => {
    const data = { candidates: [cand('recommended'), cand('fullPlacement', { placed: 1 })], excluded: [], raid: getRaid('serka-hard')! };
    render(<PlanBoard raidIds={['serka-hard']} plans={{ 'serka-hard': { status: 'ready', data } }} friends={friends} hasAttendees />);
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['⭐추천 1', '모두 편성']);
  });
});
