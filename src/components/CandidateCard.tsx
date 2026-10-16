import { Fragment } from 'react';
import type { Candidate, Friend, Party, Slot } from '@/core/types';
import { getRaid } from '@/core/raids';
import { arrangeParty } from '@/lib/arrange-party';
import { ROLE_LABEL, formatCP, formatLevel, planSummaryText } from '@/lib/view-model';
import { TierBadge } from './TierBadge';

function MemberRow({ s, names }: { s: Slot; names: Map<string, string> }) {
  return s.kind === 'friend' ? (
    <li className="member">
      <span className={`role role--${s.character.role}`}>{ROLE_LABEL[s.character.role]}</span>
      <span className="member__who">
        <span className="member__friend">{names.get(s.friendId) ?? '알 수 없음'}</span>
        <span className="member__char">{s.character.name}</span>
      </span>
      <span className="member__stats">
        <span className="num muted">{formatLevel(s.character.itemLevel)}</span>
        <span className="num member__cp">{formatCP(s.character.combatPower)}</span>
      </span>
    </li>
  ) : (
    <li className="member member--external">
      <span className={`role role--${s.role} role--ghost`}>{ROLE_LABEL[s.role]}</span>
      <span className="member__who">{s.role === 'support' ? '외부 서포터' : '외부 딜러'}</span>
    </li>
  );
}

function PartyBlock({ party, index, rank, names, size }: { party: Party; index: number; rank: number; names: Map<string, string>; size: number }) {
  const blocks = arrangeParty(party, size);
  const label = `추천 ${rank + 1} ${index + 1}공대`;
  return (
    <section className={`party party--${party.tier}`} aria-label={`추천 ${rank + 1} ${index + 1}공대`}>
      <header className="party__head">
        <span className="party__name">{index + 1}공대</span>
        <span className="party__avg">
          <span className="party__avg-label">딜러 평균</span>
          <span className="party__avg-value num">{formatCP(party.dealerAvgCP)}</span>
        </span>
        <TierBadge tier={party.tier} />
      </header>
      <div className="members__cols">
        <span className="members__col members__col--level">레벨</span>
        <span className="members__col members__col--cp">전투력</span>
      </div>
      {blocks.map((block, b) => (
        <Fragment key={b}>
          {b > 0 && <hr className="members__divider" />}
          <ul className="members" aria-label={blocks.length > 1 ? `${label} 4인 파티 ${'AB'[b]}` : undefined}>
            {block.map((s, i) => (
              <MemberRow key={s.kind === 'friend' ? `${s.friendId}:${s.character.name}` : `ext-${i}`} s={s} names={names} />
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
}

/** 추천 하나 = 완성된 편성. 요약 한 줄 아래에 1공대, 2공대, …를 반응형 그리드(넓으면 2~3열, 좁으면 1열)로 놓는다. */
export function CandidateCard({
  candidate,
  rank,
  friends,
  raidId,
}: {
  candidate: Candidate;
  rank: number;
  friends: Friend[];
  raidId: string;
}) {
  const names = new Map(friends.map((f) => [f.id, f.displayName]));
  const titleId = `cand-${raidId}-${rank}`; // 레이드마다 섹션이 따로 있어 레이드 id를 넣어야 겹치지 않는다
  const best = rank === 0;
  const size = getRaid(raidId)?.size ?? (candidate.parties[0]?.slots.length === 8 ? 8 : 4);
  return (
    <article className={`candidate${best ? ' candidate--best' : ''}`} aria-labelledby={titleId}>
      <header className="candidate__head">
        <h4 id={titleId} className="candidate__title">
          {best && (
            <span className="candidate__star" aria-hidden="true">
              ⭐
            </span>
          )}
          추천 {rank + 1}
        </h4>
        {best && <span className="candidate__pick">가장 좋은 편성</span>}
        <p className={`candidate__summary${candidate.summary.externalCount ? '' : ' candidate__summary--none'}`}>
          {planSummaryText(candidate.summary)}
        </p>
      </header>
      <div className="candidate__parties" role="group" aria-label={`추천 ${rank + 1} 공대 목록`}>
        {candidate.parties.map((p, i) => (
          <PartyBlock key={i} party={p} index={i} rank={rank} names={names} size={size} />
        ))}
      </div>
      {candidate.parties.length > 1 && candidate.imbalance > 0 && (
        <footer className="candidate__foot muted">공대 간 딜러 평균 차이 {formatCP(candidate.imbalance)}</footer>
      )}
    </article>
  );
}
