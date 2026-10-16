import type { Proficiency, ProficiencySummary } from '@/core/types';
import { NO_EXPERT_TEXT, proficiencySummaryText } from '@/core/proficiency';
import { PROFICIENCY_META } from '@/lib/view-model';

/** 숙련도 배지: 모양 아이콘(● ◐ ○) + 글자. 색은 보조 수단일 뿐이다. */
export function ProficiencyBadge({ level }: { level: Proficiency }) {
  const meta = PROFICIENCY_META[level];
  return (
    <span className={`prof prof--${meta.cls}`} title={`숙련도: ${level}`}>
      <span className="prof__icon" aria-hidden="true">
        {meta.icon}
      </span>
      <span className="prof__label">{level}</span>
    </span>
  );
}

/**
 * 공대 머리의 숙련도 요약 "숙련 1 · 반숙 1 · 클경 0"(항상)과, 숙련도를 추적 중이고 숙련자가 없으면 "숙련자 없음" 경고.
 * 아무도 숙련도를 정하지 않았으면 모든 공대가 숙련자 없음이라 경고가 소음이 되므로 숨긴다.
 */
export function ProficiencySummaryLine({ summary, tracked }: { summary: ProficiencySummary; tracked: boolean }) {
  return (
    <div className="party__prof">
      <span className="party__prof-text" title="공대 안 친구 캐릭터의 숙련도 (외부 인원은 빠져요)">
        {proficiencySummaryText(summary)}
      </span>
      {tracked && summary.noExpert && (
        <span className="prof-warn" title="이 공대에는 숙련인 친구 캐릭터가 없어요">
          <span className="prof-warn__icon" aria-hidden="true">
            ⚠
          </span>
          <span>{NO_EXPERT_TEXT}</span>
        </span>
      )}
    </div>
  );
}
