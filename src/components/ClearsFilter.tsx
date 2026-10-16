import type { Friend } from '@/core/types';

export const ALL_FILTER = 'all';

/** 이번 주 클리어 표 위의 친구별 필터. 친구를 등록/삭제하면 칩도 따라 늘고 줄어든다. */
export function ClearsFilter({ friends, value, onChange }: { friends: Friend[]; value: string; onChange: (id: string) => void }) {
  const total = friends.reduce((n, f) => n + f.characters.length, 0);
  const items = [{ id: ALL_FILTER, label: '전체', count: total }, ...friends.map((f) => ({ id: f.id, label: f.displayName, count: f.characters.length }))];
  return (
    <div className="filter-bar" role="group" aria-label="친구별로 보기">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="filter-chip"
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
        >
          {it.label} <span className="filter-chip__count">{it.count}</span>
        </button>
      ))}
    </div>
  );
}
