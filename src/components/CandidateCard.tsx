import { Fragment } from 'react';
import type { Candidate, Friend, Party, Slot } from '@/core/types';
import { getRaid } from '@/core/raids';
import { arrangeParty } from '@/lib/arrange-party';
import { ROLE_LABEL, formatCP, formatLevel, planSummaryText } from '@/lib/view-model';
import { TierBadge } from './TierBadge';
import { UnplacedList } from './UnplacedList';
import { ProficiencyBadge, ProficiencySummaryLine } from './ProficiencyBadge';
import { DEFAULT_PROFICIENCY, partyProficiency, showProficiencyBadge } from '@/core/proficiency';

function MemberRow({ s, names, tracked }: { s: Slot; names: Map<string, string>; tracked: boolean }) {
  const level = s.kind === 'friend' ? s.proficiency ?? DEFAULT_PROFICIENCY : DEFAULT_PROFICIENCY;
  return s.kind === 'friend' ? (
    <li className="member">
      <span className={`role role--${s.character.role}`}>{ROLE_LABEL[s.character.role]}</span>
      <span className="member__who">
        <span className="member__friend">{names.get(s.friendId) ?? '알 수 없음'}</span>
        <span className="member__line">
          <span className="member__char">{s.character.name}</span>
          {showProficiencyBadge(level, tracked) && <ProficiencyBadge level={level} />}
        </span>
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

function PartyBlock({ party, index, name, names, size, tracked }: {
  party: Party; index: number; name: string; names: Map<string, string>; size: number; tracked: boolean;
}) {
  const blocks = arrangeParty(party, size);
  const label = `${name} ${index + 1}공대`;
  return (
    <section className={`party party--${party.tier}`} aria-label={label}>
      <header className="party__head">
        <span className="party__name">{index + 1}공대</span>
        <span className="party__avg">
          <span className="party__avg-label">딜러 평균</span>
          <span className="party__avg-value num">{formatCP(party.dealerAvgCP)}</span>
        </span>
        <TierBadge tier={party.tier} />
        <ProficiencySummaryLine summary={partyProficiency(party)} tracked={tracked} />
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
              <MemberRow key={s.kind === 'friend' ? `${s.friendId}:${s.character.name}` : `ext-${i}`} s={s} names={names} tracked={tracked} />
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
}

/** "모두 편성" 대안의 비교 한 줄. 숫자가 없거나 0인 부분은 뺀다. 외부 인원은 굵게 + 경고 아이콘/글자 (색만으로 구분하지 않는다). */
function FullPlacementNote({ summary }: { summary: Candidate['summary'] }) {
  const ext = summary.extraExternalVsBest ?? 0;
  const placed = summary.extraPlacedVsBest ?? 0;
  if (ext <= 0 && placed <= 0) return null;
  return (
    <p className="candidate__note">
      <span className="candidate__note-lead">추천보다 </span>
      {ext > 0 && (
        <span className="candidate__note-ext">
          <span aria-hidden="true">⚠ </span>외부 {ext}명 더 필요해요
        </span>
      )}
      {ext > 0 && placed > 0 && <span> · </span>}
      {placed > 0 && <span className="candidate__note-placed">캐릭터 {placed}개 더 편성</span>}
    </p>
  );
}

/**
 * 추천 하나 = 완성된 편성. 요약 한 줄 아래에 1공대, 2공대, …를 반응형 그리드(넓으면 2~3열, 좁으면 1열)로 놓고,
 * 그 아래에 이번 추천에서 편성되지 못한 후보 캐릭터(unplaced)를 보여 준다.
 */
export function CandidateCard({
  candidate,
  rank,
  number,
  friends,
  raidId,
  proficiencyTracked = false,
}: {
  candidate: Candidate;
  /** 목록에서의 위치 (0부터; id를 겹치지 않게 하는 데만 쓴다). */
  rank: number;
  /** 추천 번호 (추천만 센다). 없으면 rank + 1. "모두 편성" 대안에는 쓰지 않는다. */
  number?: number;
  friends: Friend[];
  raidId: string;
  /** 이 편성에서 숙련도를 직접 정한 캐릭터가 있는가 (PlanResult.proficiencyTracked). 없으면 경고/기본 배지를 숨긴다. */
  proficiencyTracked?: boolean;
}) {
  const names = new Map(friends.map((f) => [f.id, f.displayName]));
  const titleId = `cand-${raidId}-${rank}`; // 레이드마다 섹션이 따로 있어 레이드 id를 넣어야 겹치지 않는다
  const full = candidate.kind === 'fullPlacement';
  const num = number ?? rank + 1;
  const best = !full && num === 1;
  const name = full ? '모두 편성' : `추천 ${num}`;
  const size = getRaid(raidId)?.size ?? (candidate.parties[0]?.slots.length === 8 ? 8 : 4);
  return (
    <article className={`candidate${best ? ' candidate--best' : ''}${full ? ' candidate--full' : ''}`} aria-labelledby={titleId}>
      <header className="candidate__head">
        <h4 id={titleId} className="candidate__title">
          {best && (
            <span className="candidate__star" aria-hidden="true">
              ⭐
            </span>
          )}
          {name}
        </h4>
        {best && <span className="candidate__pick">가장 좋은 편성</span>}
        {full && <FullPlacementNote summary={candidate.summary} />}
        <p className={`candidate__summary${candidate.summary.externalCount ? '' : ' candidate__summary--none'}`}>
          {planSummaryText(candidate.summary)}
        </p>
      </header>
      <div className="candidate__parties" role="group" aria-label={`${name} 공대 목록`}>
        {candidate.parties.map((p, i) => (
          <PartyBlock key={i} party={p} index={i} name={name} names={names} size={size} tracked={proficiencyTracked} />
        ))}
      </div>
      <UnplacedList unplaced={candidate.unplaced ?? []} names={names} label={name} />
      {candidate.parties.length > 1 && candidate.imbalance > 0 && (
        <footer className="candidate__foot muted">공대 간 딜러 평균 차이 {formatCP(candidate.imbalance)}</footer>
      )}
    </article>
  );
}
