'use client';

import { useState } from 'react';
import type { Character, ClearRecord, Friend, Role } from '@/core/types';
import { RAID_GROUPS, ROLE_LABEL, clearValue, formatLevel } from '@/lib/view-model';
import { sortCharactersByPower } from '@/lib/character-sort';
import { CombatPowerCell } from './CombatPowerCell';

/**
 * 역할 배지 겸 토글. 자동 판별 상태에서 누르면 반대 역할로 수동 지정, 수동 상태에서 누르면 자동으로 되돌린다.
 * (자동 → 서포터/딜러 수동 → 자동) 직업만으로 역할을 잘못 판별한 캐릭터를 바로잡는 용도.
 */
function RoleToggle({ character, onSave }: { character: Character; onSave: (role: Role | null) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manual = !!character.manualRole;
  const other: Role = character.role === 'support' ? 'dealer' : 'support';
  const next: Role | null = manual ? null : other;
  const label = `${character.name} 역할: ${ROLE_LABEL[character.role]} (${manual ? '수동' : '자동'}). ${
    next === null ? '누르면 자동으로 되돌려요' : `누르면 ${ROLE_LABEL[next]}로 바꿔요`
  }`;
  async function click() {
    setBusy(true);
    setError(null);
    const err = await onSave(next);
    setBusy(false);
    if (err) setError(err);
  }
  return (
    <span className="role-cell">
      <button
        type="button"
        className={`role role--${character.role} role--button`}
        onClick={click}
        disabled={busy}
        aria-label={label}
        title={label}
      >
        {ROLE_LABEL[character.role]}
        {manual && <span className="manual-mark">수동</span>}
      </button>
      {error && (
        <span className="alert alert--error cp-form__error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** 친구 × 캐릭터 표. 레이드 이름마다 드롭다운 하나라서 한 레이드에 두 난이도가 동시에 표시될 수 없다. */
export function ClearsTable({
  friends,
  showFriendNames = true,
  clears,
  onClearChange,
  onCombatPower,
  onRole,
}: {
  friends: Friend[];
  /** 한 친구만 보여 줄 때는 친구 이름 줄을 생략한다. */
  showFriendNames?: boolean;
  clears: ClearRecord[];
  onClearChange: (characterName: string, raidName: string, difficulty: string) => void;
  onCombatPower: (friendId: string, characterName: string, cp: number | null) => Promise<string | null>;
  onRole: (friendId: string, characterName: string, role: Role | null) => Promise<string | null>;
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
            {showFriendNames && (
              <tr className="roster__friend">
                <th scope="rowgroup" colSpan={4 + RAID_GROUPS.length}>
                  <span className="roster__friend-name">{f.displayName}</span>
                </th>
              </tr>
            )}
            {f.characters.length === 0 && (
              <tr>
                <td colSpan={4 + RAID_GROUPS.length} className="muted">
                  불러온 캐릭터가 없어요. 위에서 갱신해 보세요.
                </td>
              </tr>
            )}
            {sortCharactersByPower(f.characters).map((c) => (
              <tr key={c.name}>
                <th scope="row" className="roster__sticky roster__char">
                  <span className="roster__char-name">{c.name}</span>
                  <span className="muted">{c.className}</span>
                </th>
                <td>
                  <RoleToggle character={c} onSave={(role) => onRole(f.id, c.name, role)} />
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
