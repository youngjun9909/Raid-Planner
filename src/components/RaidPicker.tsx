'use client';

import type { Friend } from '@/core/types';
import { RAID_GROUPS, formatRange } from '@/lib/view-model';

export function RaidPicker({
  selected,
  onToggleRaid,
  friends,
  absent,
  onToggleFriend,
}: {
  selected: string[];
  onToggleRaid: (raidId: string) => void;
  friends: Friend[];
  absent: Set<string>;
  onToggleFriend: (friendId: string) => void;
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
              {g.raids.map((r) => (
                <label key={r.id} className="chip" title={`입장 ${r.minLevel}, 권장 전투력 ${formatRange(r)}`}>
                  <input
                    type="checkbox"
                    className="chip__input"
                    checked={selected.includes(r.id)}
                    onChange={() => onToggleRaid(r.id)}
                    aria-label={`${g.name} ${r.difficulty}`}
                  />
                  <span className="chip__face">
                    {r.difficulty}
                    <span className="chip__meta num">{r.minLevel}</span>
                  </span>
                </label>
              ))}
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
