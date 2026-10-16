'use client';

import type { Friend } from '@/core/types';
import { RAID_GROUPS, formatRange } from '@/lib/view-model';

export const NO_CANDIDATE_TEXT = '갈 수 있는 캐릭터 없음';

/**
 * 레이드와 참석자 고르기. 난이도 칩마다 참석하는 친구 중 갈 수 있는 캐릭터 수를 보여 주고 (counts: 레이드 id → 수),
 * 수가 0인 난이도는 비활성으로 "없음"을 표시한다. 이미 고른 난이도가 0이 되면 선택은 그대로 두고(다시 끌 수 있게) 안내를 보인다.
 */
export function RaidPicker({
  selected,
  onToggleRaid,
  friends,
  absent,
  onToggleFriend,
  counts,
}: {
  selected: string[];
  onToggleRaid: (raidId: string) => void;
  friends: Friend[];
  absent: Set<string>;
  onToggleFriend: (friendId: string) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="picker">
      <fieldset className="picker__raids">
        <legend className="picker__legend">이번 주에 돌 레이드</legend>
        {RAID_GROUPS.map((g) => (
          <div key={g.name} className="raid-row">
            <span className="raid-row__name">{g.name}</span>
            <span className="raid-row__size muted">{g.raids[0].size}인</span>
            <div className="chips">
              {g.raids.map((r) => {
                const n = counts[r.id] ?? 0;
                const checked = selected.includes(r.id);
                const empty = n === 0;
                const hintId = `pick-hint-${r.id}`;
                const hint = empty ? NO_CANDIDATE_TEXT : `갈 수 있는 캐릭터 ${n}개`;
                return (
                  <label
                    key={r.id}
                    className={`chip${empty ? ' chip--empty' : ''}${empty && checked ? ' chip--stranded' : ''}`}
                    title={`입장 ${r.minLevel}, 권장 전투력 ${formatRange(r)}${empty ? ` · ${NO_CANDIDATE_TEXT}` : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="chip__input"
                      checked={checked}
                      disabled={empty && !checked}
                      onChange={() => onToggleRaid(r.id)}
                      aria-label={`${g.name} ${r.difficulty}`}
                      aria-describedby={hintId}
                    />
                    <span className="chip__face">
                      {r.difficulty}
                      {!(empty && checked) && (
                        <span className="chip__count num" aria-hidden="true">
                          {' · '}
                          {empty ? '없음' : n}
                        </span>
                      )}
                      <span id={hintId} className={empty && checked ? 'chip__hint' : 'visually-hidden'}>
                        {empty && checked && <span aria-hidden="true">{' · '}</span>}
                        {hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>

      <fieldset className="picker__people">
        <legend className="picker__legend">참석하는 친구</legend>
        <div className="chips">
          {friends.map((f) => (
            <label key={f.id} className="chip chip--person">
              <input
                type="checkbox"
                className="chip__input"
                checked={!absent.has(f.id)}
                onChange={() => onToggleFriend(f.id)}
              />
              <span className="chip__face">{f.displayName}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
