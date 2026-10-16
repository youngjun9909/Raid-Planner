import type { Candidate, Friend, Party } from '@/core/types';
import { ROLE_LABEL, countExternals, externalSummary, formatCP, formatLevel } from '@/lib/view-model';
import { TierBadge } from './TierBadge';

function PartyBlock({ party, index, names }: { party: Party; index: number; names: Map<string, string> }) {
  return (
    <section className={`party party--${party.tier}`} aria-label={`${index + 1}공대`}>
      <header className="party__head">
        <span className="party__name">{index + 1}공대</span>
        <span className="party__avg">
          <span className="party__avg-label">딜러 평균</span>
          <span className="party__avg-value num">{formatCP(party.dealerAvgCP)}</span>
        </span>
        <TierBadge tier={party.tier} />
      </header>
      <ul className="members">
        {party.slots.map((s, i) =>
          s.kind === 'friend' ? (
            <li key={`${s.friendId}:${s.character.name}`} className="member">
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
            <li key={`ext-${i}`} className="member member--external">
              <span className={`role role--${s.role} role--ghost`}>{ROLE_LABEL[s.role]}</span>
              <span className="member__who">{s.role === 'support' ? '외부 서포터' : '외부 딜러'}</span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

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
  const ext = candidate.parties.reduce(
    (acc, p) => {
      const c = countExternals(p.slots);
      return { support: acc.support + c.support, dealer: acc.dealer + c.dealer };
    },
    { support: 0, dealer: 0 },
  );
  const titleId = `cand-${raidId}-${rank}`; // 레이드마다 섹션이 따로 있어 레이드 id를 넣어야 겹치지 않는다
  return (
    <article className="candidate" aria-labelledby={titleId}>
      <header className="candidate__head">
        <h4 id={titleId} className="candidate__label">
          <span className="candidate__split">{candidate.label}</span>
          <span className="candidate__split-word">분배</span>
        </h4>
        {rank === 0 && <span className="candidate__pick">추천</span>}
      </header>
      <div className="candidate__parties">
        {candidate.parties.map((p, i) => (
          <PartyBlock key={i} party={p} index={i} names={names} />
        ))}
      </div>
      <footer className={`candidate__foot${candidate.externalCount ? '' : ' candidate__foot--none'}`}>
        {externalSummary(ext.support, ext.dealer)}
        {candidate.parties.length > 1 && candidate.imbalance > 0 && (
          <span className="muted"> (공대 간 평균 차이 {formatCP(candidate.imbalance)})</span>
        )}
      </footer>
    </article>
  );
}
