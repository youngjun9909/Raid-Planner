'use client';

import type { ClearRecord, Friend } from '@/core/types';
import { RAID_GROUPS, ROLE_LABEL, clearValue, formatLevel } from '@/lib/view-model';
import { CombatPowerCell } from './CombatPowerCell';

/** 친구 × 캐릭터 표. 레이드 이름마다 드롭다운 하나라서 한 레이드에 두 난이도가 동시에 표시될 수 없다. */
export function ClearsTable({
  friends,
  clears,
  onClearChange,
  onCombatPower,
}: {
  friends: Friend[];
  clears: ClearRecord[];
  onClearChange: (characterName: string, raidName: string, difficulty: string) => void;
  onCombatPower: (friendId: string, characterName: string, cp: number | null) => Promise<string | null>;
}) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="이번 주 클리어 표 (가로로 밀어서 볼 수 있어요)">
      <table className="roster">
        <thead>
          <tr>
            <th scope="col" className="roster__sticky">
              캐릭터
            </th>
            <th scope="col">역할</th>
            <th scope="col" className="num-col">
              아이템 레벨
            </th>
            <th scope="col" className="num-col">
              전투력
            </th>
            {RAID_GROUPS.map((g) => (
              <th scope="col" key={g.name} className="roster__raid">
                {g.name}
              </th>
            ))}
          </tr>
        </thead>
        {friends.map((f) => (
          <tbody key={f.id} className="roster__group">
            <tr className="roster__friend">
              <th scope="rowgroup" colSpan={4 + RAID_GROUPS.length}>
                <span className="roster__friend-name">{f.displayName}</span>
              </th>
            </tr>
            {f.characters.length === 0 && (
              <tr>
                <td colSpan={4 + RAID_GROUPS.length} className="muted">
                  불러온 캐릭터가 없어요. 위에서 갱신해 보세요.
                </td>
              </tr>
            )}
            {f.characters.map((c) => (
              <tr key={c.name}>
                <th scope="row" className="roster__sticky roster__char">
                  <span className="roster__char-name">{c.name}</span>
                  <span className="muted">{c.className}</span>
                </th>
                <td>
                  <span className={`role role--${c.role}`}>{ROLE_LABEL[c.role]}</span>
                </td>
                <td className="num-col num">{formatLevel(c.itemLevel)}</td>
                <td className="num-col">
                  <CombatPowerCell character={c} onSave={(cp) => onCombatPower(f.id, c.name, cp)} />
                </td>
                {RAID_GROUPS.map((g) => {
                  const value = clearValue(clears, c.name, g.name);
                  return (
                    <td key={g.name}>
                      <select
                        className={`select${value ? ' select--done' : ''}`}
                        value={value}
                        onChange={(e) => onClearChange(c.name, g.name, e.target.value)}
                        aria-label={`${c.name} ${g.name} 클리어`}
                      >
                        <option value="">안 감</option>
                        {g.raids.map((r) => (
                          <option key={r.id} value={r.difficulty}>
                            {r.difficulty}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
