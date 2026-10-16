'use client';

import { useState, type FormEvent } from 'react';

export const PASSWORD_KEY = 'loa-raid-planner:password';

// 저장소는 사생활 보호 모드 등에서 막힐 수 있으므로 항상 try/catch로 감싼다. 없어도 화면은 동작한다.
export function readStoredPassword(): string | null {
  try {
    return localStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

export function storePassword(pw: string | null): void {
  try {
    if (pw === null) localStorage.removeItem(PASSWORD_KEY);
    else localStorage.setItem(PASSWORD_KEY, pw);
  } catch {
    /* 저장 못 해도 이번 접속에서는 계속 쓴다 */
  }
}

export function PasswordGate({
  onSubmit,
  message,
}: {
  /** 성공하면 null, 실패하면 보여 줄 안내 문구. */
  onSubmit: (password: string) => Promise<string | null>;
  message?: string | null;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(message ?? null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit(value);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="gate">
      <form className="gate__card" onSubmit={submit}>
        <h1 className="gate__title">이번 주 공대</h1>
        <p className="gate__lead">친구들끼리 정한 비밀번호를 입력하면 원정대와 공대 후보를 볼 수 있어요.</p>
        <label className="field">
          <span className="field__label">비밀번호</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'gate-error' : undefined}
            autoFocus
          />
        </label>
        {error && (
          <p id="gate-error" className="alert alert--error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary" type="submit" disabled={busy || !value}>
          {busy ? '확인하는 중…' : '입장하기'}
        </button>
      </form>
    </div>
  );
}
