'use client';

import { useState, type FormEvent } from 'react';
import type { Character } from '@/core/types';
import { formatCP } from '@/lib/view-model';

/**
 * 전투력 칸. 값이 없으면(null) 바로 수동 입력칸을 보여 주고, 값이 있으면 "수정"으로 덮어쓸 수 있다.
 * 빈 값으로 저장하거나 "자동 값으로"를 누르면 수동 값을 지운다(cp: null). 수동 값에는 "수동" 표시가 붙는다.
 */
export function CombatPowerCell({
  character,
  onSave,
}: {
  character: Character;
  onSave: (cp: number | null) => Promise<string | null>;
}) {
  const missing = character.combatPower === null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!missing && !editing) {
    return (
      <span className="cp">
        <span className="num">{formatCP(character.combatPower)}</span>
        {character.manualCombatPower && (
          <>
            <span className="manual-mark" title="직접 입력한 값이에요. 주간 갱신 뒤에도 유지돼요">
              수동
            </span>
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const err = await onSave(null);
                setBusy(false);
                if (err) setError(err);
              }}
              aria-label={`${character.name} 전투력 자동 값으로 되돌리기`}
              title="직접 입력한 값을 지우고 로스트아크에서 불러온 값으로 돌아가요"
            >
              자동 값으로
            </button>
          </>
        )}
        {error && (
          <span className="alert alert--error cp-form__error" role="alert">
            {error}
          </span>
        )}
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setValue(String(Math.round(character.combatPower as number)));
            setEditing(true);
          }}
          aria-label={`${character.name} 전투력 수정`}
        >
          수정
        </button>
      </span>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    const cp = trimmed === '' ? null : Number(trimmed);
    if (cp !== null && (!Number.isFinite(cp) || cp < 0)) {
      setError('0 이상의 숫자를 넣어 주세요');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onSave(cp);
    setBusy(false);
    if (err) setError(err);
    else {
      setEditing(false);
      setValue('');
    }
  }

  return (
    <form className="cp-form" onSubmit={submit}>
      <input
        className="input input--compact num"
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={missing ? '직접 입력' : ''}
        aria-label={`${character.name} 전투력`}
        aria-invalid={error ? true : undefined}
        disabled={busy}
      />
      <button type="submit" className="btn btn--small" disabled={busy}>
        저장
      </button>
      {editing && (
        <button type="button" className="link-btn" onClick={() => setEditing(false)}>
          취소
        </button>
      )}
      {error && (
        <span className="alert alert--error cp-form__error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
