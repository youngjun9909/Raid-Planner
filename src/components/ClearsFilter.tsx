import type { Friend } from '@/core/types';
import { visibleCharacters } from '@/core/visible';

export const ALL_FILTER = 'all';

/** 이번 주 클리어 카드 위의 친구별 필터. 친구를 등록/삭제하면 칩도 따라 늘고 줄어든다. */
export function ClearsFilter({ friends, value, onChange }: { friends: Friend[]; value: string; onChange: (id: string) => void }) {
  const count = (f: Friend) => visibleCharacters(f.characters).length; // 화면에 보이는 캐릭터(1700 이상)만 센다
  const total = friends.reduce((n, f) => n + count(f), 0);
  const items = [{ id: ALL_FILTER, label: '전체', count: total }, ...friends.map((f) => ({ id: f.id, label: f.displayName, count: count(f) }))];
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
