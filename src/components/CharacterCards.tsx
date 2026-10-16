'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Character, ClearRecord, Friend, Proficiency, Role } from '@/core/types';
import { visibleCharacters } from '@/core/visible';
import { MIN_RAID_LEVEL } from '@/core/raids';
import { SKIP_DIFFICULTY } from '@/core/difficulty';
import { PROFICIENCIES, isProficiency } from '@/core/proficiency';
import { PROFICIENCY_META, ROLE_LABEL, chipToggleDifficulty, formatLevel, raidChips, type RaidChipModel } from '@/lib/view-model';
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

/** 칩 누르기 버튼의 접근성 이름: 캐릭터, 레이드, 난이도, 상태 ("가나 세르카 하드: 미완" / "… 노말: 갔음" / "가나 세르카: 안 감"). */
export function chipLabel(characterName: string, chip: RaidChipModel): string {
  if (chip.cleared) return `${characterName} ${chip.raidName} ${chip.cleared}: 갔음`;
  if (chip.target === null) return `${characterName} ${chip.raidName}: 안 감`;
  return `${characterName} ${chip.raidName} ${chip.target}: 미완`;
}

/** 직접 정한 값 표시 (기본값은 흐리게, 직접 정한 값만 또렷하게 + 이 표시). */
const SetMark = () => <span className="manual-mark rchip__set">직접 정함</span>;

/**
 * 칩의 설정 칸: 가는 난이도(자동/난이도들/안 감)와 숙련도(숙련/반숙/클경, 정하지 않으면 반숙).
 * 떠 있는 팝오버 대신 칩 아래에 펼쳐지는 칸이라 터치/키보드/좁은 화면에서도 위치가 어긋나거나 잘리지 않는다.
 */
function ChipSettings({
  id,
  characterName,
  chip,
  onTargetDifficulty,
  onProficiency,
  onClose,
}: {
  id: string;
  characterName: string;
  chip: RaidChipModel;
  onTargetDifficulty: (value: string | null) => void;
  onProficiency: (level: Proficiency | null) => void;
  onClose: () => void;
}) {
  // 레벨보다 높은 난이도를 직접 정해 둔 경우(예전 값)도 선택 상자에 그대로 보이게 한다.
  const stale = chip.override !== undefined && chip.override !== SKIP_DIFFICULTY && !chip.options.includes(chip.override);
  const prof = chip.proficiency;
  return (
    <div className="rchip__panel" id={id} role="group" aria-label={`${characterName} ${chip.raidName} 설정`}>
      <label className="rchip__field">
        <span className="rchip__field-label">가는 난이도</span>
        <span className="rchip__field-row">
          <select
            className={`select select--setting${chip.override === undefined ? ' select--default' : ''}`}
            value={chip.override ?? ''}
            onChange={(e) => onTargetDifficulty(e.target.value === '' ? null : e.target.value)}
            aria-label={`${characterName} ${chip.raidName} 가는 난이도`}
          >
            <option value="">자동 ({chip.auto})</option>
            {chip.options.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {stale && <option value={chip.override}>{chip.override} (레벨 부족)</option>}
            <option value={SKIP_DIFFICULTY}>{SKIP_DIFFICULTY}</option>
          </select>
          {chip.override !== undefined && <SetMark />}
        </span>
      </label>
      <label className="rchip__field">
        <span className="rchip__field-label">숙련도</span>
        <span className="rchip__field-row">
          <select
            className={`select select--setting select--prof ${prof ? `select--prof-${PROFICIENCY_META[prof].cls}` : 'select--default select--prof-default'}`}
            value={prof ?? ''}
            onChange={(e) => onProficiency(isProficiency(e.target.value) ? e.target.value : null)}
            aria-label={`${characterName} ${chip.raidName} 숙련도`}
            title={prof ? `숙련도: ${prof}` : '숙련도: 정하지 않음 (기본값 반숙)'}
          >
            <option value="">{PROFICIENCY_META['반숙'].icon} 반숙 (기본)</option>
            {PROFICIENCIES.map((p) => (
              <option key={p} value={p}>
                {PROFICIENCY_META[p].icon} {p}
              </option>
            ))}
          </select>
          {prof && <SetMark />}
        </span>
      </label>
      <button type="button" className="link-btn rchip__close" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}

/**
 * 레이드 칩 하나: 한 번 누르면 이번 주 클리어를 토글한다 (안 갔으면 가는 난이도로 기록, 갔으면 어느 난이도든 해제).
 * 상태는 글자와 아이콘(✓ / ○)으로 보여 주고 색에만 의존하지 않는다. `안 감`이면 흐리게, 누를 수 없다.
 * 옆의 ⋯ 버튼으로 칩 아래에 설정 칸을 펼친다 (Escape로 닫고 ⋯ 버튼으로 돌아간다).
 */
function RaidChip({
  characterName,
  chip,
  onToggle,
  onTargetDifficulty,
  onProficiency,
  initialOpen = false,
}: {
  characterName: string;
  chip: RaidChipModel;
  onToggle: (difficulty: string) => void;
  onTargetDifficulty: (value: string | null) => void;
  onProficiency: (level: Proficiency | null) => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const next = chipToggleDifficulty(chip);
  const done = !!chip.cleared;
  const skip = !done && chip.target === null;
  const customized = chip.override !== undefined || chip.proficiency !== undefined;
  const cls = `rchip${done ? ' rchip--done' : ''}${skip ? ' rchip--skip' : ''}${open ? ' rchip--open' : ''}`;
  const close = () => {
    setOpen(false);
    settingsRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close();
    }
  };
  return (
    <li className={cls} onKeyDown={onKeyDown}>
      <span className="rchip__row">
        <button
          type="button"
          className="rchip__toggle"
          aria-pressed={done}
          aria-label={chipLabel(characterName, chip)}
          title={skip ? '이 레이드는 안 가요 (⋯에서 바꿀 수 있어요)' : done ? '누르면 클리어 표시를 지워요' : `누르면 ${chip.target}로 클리어 표시해요`}
          disabled={next === null}
          onClick={() => next !== null && onToggle(next)}
        >
          <span className="rchip__icon" aria-hidden="true">
            {done ? '✓' : skip ? '–' : '○'}
          </span>
          <span className="rchip__name">{chip.raidName}</span>
          <span className="rchip__diff">
            {' · '}
            {chip.shown}
          </span>
        </button>
        <button
          ref={settingsRef}
          type="button"
          className="rchip__more"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`${characterName} ${chip.raidName} 설정${customized ? ' (직접 정한 값 있음)' : ''}`}
          title="가는 난이도와 숙련도 설정"
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">⋯</span>
          {customized && <span className="rchip__dot" aria-hidden="true" />}
        </button>
      </span>
      {open && (
        <ChipSettings
          id={panelId}
          characterName={characterName}
          chip={chip}
          onTargetDifficulty={onTargetDifficulty}
          onProficiency={onProficiency}
          onClose={close}
        />
      )}
    </li>
  );
}

type CardCallbacks = {
  onClearChange: (characterName: string, raidName: string, difficulty: string) => void;
  onCombatPower: (friendId: string, characterName: string, cp: number | null) => Promise<string | null>;
  onRole: (friendId: string, characterName: string, role: Role | null) => Promise<string | null>;
  /** 가는 난이도: 난이도 이름 또는 `안 감`, null이면 자동. */
  onTargetDifficulty: (friendId: string, characterName: string, raidName: string, value: string | null) => void;
  onProficiency: (friendId: string, characterName: string, raidName: string, level: Proficiency | null) => void;
  /** 카드 단위로 이 캐릭터의 모든 레이드 칩 숙련도를 같은 값으로. */
  onBulkProficiency: (friendId: string, characterName: string, raidNames: string[], level: Proficiency) => void;
};

const BULK_NONE = '';

function CharacterCard({
  friend,
  character,
  clears,
  openRaid,
  onClearChange,
  onCombatPower,
  onRole,
  onTargetDifficulty,
  onProficiency,
  onBulkProficiency,
}: CardCallbacks & { friend: Friend; character: Character; clears: ClearRecord[]; openRaid?: string }) {
  const c = character;
  const chips = raidChips(friend, c, clears);
  return (
    <li className="ccard">
      <div className="ccard__head">
        <span className="ccard__id">
          <span className="ccard__name">{c.name}</span>
          <span className="ccard__class muted">{c.className}</span>
        </span>
        <RoleToggle character={c} onSave={(role) => onRole(friend.id, c.name, role)} />
      </div>
      <dl className="ccard__stats">
        <div className="ccard__stat">
          <dt>레벨</dt>
          <dd className="num">{formatLevel(c.itemLevel)}</dd>
        </div>
        <div className="ccard__stat ccard__stat--cp">
          <dt>전투력</dt>
          <dd>
            <CombatPowerCell character={c} onSave={(cp) => onCombatPower(friend.id, c.name, cp)} />
          </dd>
        </div>
      </dl>
      <ul className="rchips" aria-label={`${c.name} 레이드`}>
        {chips.map((chip) => (
          <RaidChip
            key={chip.raidName}
            characterName={c.name}
            chip={chip}
            onToggle={(d) => onClearChange(c.name, chip.raidName, d)}
            onTargetDifficulty={(v) => onTargetDifficulty(friend.id, c.name, chip.raidName, v)}
            onProficiency={(level) => onProficiency(friend.id, c.name, chip.raidName, level)}
            initialOpen={openRaid === chip.raidName}
          />
        ))}
      </ul>
      {chips.length > 0 && (
        <label className="ccard__bulk">
          <span className="ccard__bulk-label">모든 레이드 숙련도</span>
          <select
            className="select select--setting select--default"
            value={BULK_NONE}
            onChange={(e) => {
              const level = e.target.value;
              if (isProficiency(level)) onBulkProficiency(friend.id, c.name, chips.map((x) => x.raidName), level);
            }}
            aria-label={`${c.name} 모든 레이드 숙련도 한 번에 바꾸기`}
            title="이 캐릭터의 모든 레이드를 같은 숙련도로 바꿔요. 바꾼 뒤에도 레이드마다 따로 고칠 수 있어요"
          >
            <option value={BULK_NONE}>—</option>
            {PROFICIENCIES.map((p) => (
              <option key={p} value={p}>
                {PROFICIENCY_META[p].icon} {p}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}

/**
 * 캐릭터 카드 목록 (설계 수정 2026-10-16-friend-first-amendment.md D). 친구마다 전투력 높은 순으로 카드를 쌓고,
 * 카드 안에 갈 수 있는 레이드마다 칩 하나. 1700 미만 캐릭터는 API가 이미 숨기지만 여기서도 한 번 더 거른다.
 */
export function CharacterCards({
  friends,
  showFriendNames = true,
  clears,
  openChip,
  ...callbacks
}: CardCallbacks & {
  friends: Friend[];
  /** 한 친구만 보여 줄 때는 친구 이름 제목을 생략한다. */
  showFriendNames?: boolean;
  clears: ClearRecord[];
  /** 처음부터 설정 칸을 펼쳐 둘 칩 (미리보기용). */
  openChip?: { characterName: string; raidName: string };
}) {
  return (
    <div className="roster-cards">
      {friends.map((f) => {
        const chars = sortCharactersByPower(visibleCharacters(f.characters));
        return (
          <section key={f.id} className="roster-cards__group" aria-label={`${f.displayName}의 캐릭터`}>
            {showFriendNames && <h3 className="roster-cards__friend">{f.displayName}</h3>}
            {chars.length === 0 ? (
              <p className="muted">아이템 레벨 {MIN_RAID_LEVEL} 이상인 캐릭터가 없어요. 위에서 갱신해 보세요.</p>
            ) : (
              <ul className="ccards">
                {chars.map((c) => (
                  <CharacterCard
                    key={c.name}
                    friend={f}
                    character={c}
                    clears={clears}
                    openRaid={openChip?.characterName === c.name ? openChip.raidName : undefined}
                    {...callbacks}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
