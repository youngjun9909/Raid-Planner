import { getRaid } from '@/core/raids';
import type { Friend } from '@/core/types';
import type { PlanResponse } from '@/lib/api-client';
import { formatRange } from '@/lib/view-model';
import { CandidateCard } from './CandidateCard';

export type PlanState =
  | { status: 'loading'; data?: PlanResponse }
  | { status: 'ready'; data: PlanResponse }
  | { status: 'error'; error: string; data?: PlanResponse };

function RaidPlan({ raidId, state, friends }: { raidId: string; state: PlanState | undefined; friends: Friend[] }) {
  const raid = getRaid(raidId);
  if (!raid) return null;
  const data = state?.data;
  const names = new Map(friends.map((f) => [f.id, f.displayName]));
  const loading = !state || state.status === 'loading';
  return (
    <section className="raid-plan" aria-labelledby={`plan-${raid.id}`} aria-busy={loading}>
      <header className="raid-plan__head">
        <h3 id={`plan-${raid.id}`} className="raid-plan__title">
          {raid.name} <span className="raid-plan__diff">{raid.difficulty}</span>
        </h3>
        <p className="raid-plan__meta muted">
          {raid.size}인, 입장 <span className="num">{raid.minLevel}</span>, 권장 전투력{' '}
          <span className="num">{formatRange(raid)}</span>
        </p>
        {loading && (
          <span className="raid-plan__status" role="status">
            계산하는 중…
          </span>
        )}
      </header>

      {state?.status === 'error' && (
        <p className="alert alert--error" role="alert">
          {state.error}
        </p>
      )}

      {data && data.candidates.length === 0 && (
        <div className="empty empty--plan">
          <p className="empty__title">{data.reason ?? '이 레이드는 지금 짤 수 있는 공대가 없어요'}</p>
          <p className="muted">클리어 표시나 참석자를 바꾸면 바로 다시 계산해요.</p>
        </div>
      )}

      {data && data.excluded.length > 0 && (
        <div className="excluded">
          <p className="excluded__title">이번 공대에서 빠진 친구</p>
          <ul className="excluded__list">
            {data.excluded.map((x) => (
              <li key={x.friendId}>
                <strong>{names.get(x.friendId) ?? '알 수 없는 친구'}</strong> {x.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.candidates.length > 0 && (
        <div className={`candidates${loading ? ' candidates--stale' : ''}`}>
          {data.candidates.map((c, i) => (
            <CandidateCard
              key={i}
              candidate={c}
              rank={i}
              number={data.candidates.slice(0, i + 1).filter((x) => x.kind !== 'fullPlacement').length}
              friends={friends}
              raidId={raid.id}
              proficiencyTracked={data.proficiencyTracked ?? false}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function PlanBoard({
  raidIds,
  plans,
  friends,
  hasAttendees,
}: {
  raidIds: string[];
  plans: Record<string, PlanState>;
  friends: Friend[];
  hasAttendees: boolean;
}) {
  if (raidIds.length === 0) {
    return (
      <div className="empty">
        <p className="empty__title">위에서 이번 주에 돌 레이드를 골라 주세요</p>
        <p className="muted">고른 레이드마다 추천 편성이 여기에 나와요.</p>
      </div>
    );
  }
  if (!hasAttendees) {
    return (
      <div className="empty">
        <p className="empty__title">참석하는 친구를 한 명 이상 골라 주세요</p>
      </div>
    );
  }
  return (
    <div className="plans">
      {raidIds.map((id) => (
        <RaidPlan key={id} raidId={id} state={plans[id]} friends={friends} />
      ))}
    </div>
  );
}
