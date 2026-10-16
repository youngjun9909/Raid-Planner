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

/** 공대 머리의 숙련도 요약 "숙련 1 · 반숙 1 · 클경 0"과, 숙련자가 없으면 "숙련자 없음" 경고. */
export function ProficiencySummaryLine({ summary }: { summary: ProficiencySummary }) {
  return (
    <div className="party__prof">
      <span className="party__prof-text" title="공대 안 친구 캐릭터의 숙련도 (외부 인원은 빠져요)">
        {proficiencySummaryText(summary)}
      </span>
      {summary.noExpert && (
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
