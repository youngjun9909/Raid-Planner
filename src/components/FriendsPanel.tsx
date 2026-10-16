'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Friend } from '@/core/types';

/** 원정대 조회는 20초 가까이 걸릴 수 있어 경과 시간을 함께 보여 준다. */
function useElapsed(running: boolean): number {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) return;
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  return secs;
}

function Progress({ label, secs }: { label: string; secs: number }) {
  return (
    <div className="progress" role="status">
      <span className="progress__bar" aria-hidden="true" />
      <span>
        {label} {secs > 0 && <span className="num">{secs}초</span>}
        {secs >= 8 && <span className="muted"> (원정대가 크면 20초쯤 걸려요)</span>}
      </span>
    </div>
  );
}

export function FriendsPanel({
  friends,
  onAdd,
  onRefresh,
  onDelete,
}: {
  friends: Friend[];
  onAdd: (displayName: string, representativeName: string) => Promise<string | null>;
  onRefresh: (id: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
}) {
  const [displayName, setDisplayName] = useState('');
  const [repName, setRepName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<{ id: string; msg: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; msg: string } | null>(null);
  const addSecs = useElapsed(adding);
  const refreshSecs = useElapsed(refreshing !== null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || !repName.trim()) return;
    setAdding(true);
    setAddError(null);
    const err = await onAdd(displayName.trim(), repName.trim());
    setAdding(false);
    if (err) setAddError(err);
    else {
      setDisplayName('');
      setRepName('');
    }
  }

  async function refresh(id: string) {
    setRefreshing(id);
    setRefreshError(null);
    const err = await onRefresh(id);
    setRefreshing(null);
    if (err) setRefreshError({ id, msg: err });
  }

  async function remove(id: string) {
    setDeleting(id);
    setDeleteError(null);
    const err = await onDelete(id);
    setDeleting(null);
    if (err) setDeleteError({ id, msg: err });
    else setConfirming(null);
  }

  return (
    <div className="friends">
      {friends.length > 0 && (
        <ul className="friends__list">
          {friends.map((f) => (
            <li key={f.id} className="friend">
              <div className="friend__text">
                <span className="friend__name">{f.displayName}</span>
                <span className="muted">
                  대표 {f.representativeName}, 캐릭터 {f.characters.length}개
                </span>
                {refreshing === f.id && <Progress label="다시 불러오는 중" secs={refreshSecs} />}
                {refreshError?.id === f.id && (
                  <span className="alert alert--error" role="alert">
                    {refreshError.msg}
                  </span>
                )}
                {confirming === f.id && (
                  <div className="friend__confirm" role="group" aria-label={`${f.displayName} 삭제 확인`}>
                    <span>{f.displayName}의 원정대와 이번 주 클리어 기록을 지울까요? 되돌릴 수 없어요.</span>
                    <span className="friend__confirm-actions">
                      <button
                        type="button"
                        className="btn btn--small btn--danger"
                        onClick={() => remove(f.id)}
                        disabled={deleting !== null}
                      >
                        {deleting === f.id ? '지우는 중…' : '삭제하기'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--small btn--quiet"
                        onClick={() => setConfirming(null)}
                        disabled={deleting !== null}
                        autoFocus
                      >
                        취소
                      </button>
                    </span>
                    {deleteError?.id === f.id && (
                      <span className="alert alert--error" role="alert">
                        {deleteError.msg}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span className="friend__actions">
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => refresh(f.id)}
                  disabled={refreshing !== null}
                  aria-label={`${f.displayName} 원정대 다시 불러오기`}
                >
                  갱신
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => {
                    setDeleteError(null);
                    setConfirming(f.id);
                  }}
                  disabled={deleting !== null || confirming === f.id}
                  aria-label={`${f.displayName} 삭제`}
                >
                  삭제
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="friends__form" onSubmit={add}>
        <label className="field">
          <span className="field__label">친구 이름</span>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="예: 영준"
            disabled={adding}
          />
        </label>
        <label className="field">
          <span className="field__label">대표 캐릭터</span>
          <input
            className="input"
            value={repName}
            onChange={(e) => setRepName(e.target.value)}
            placeholder="게임 속 캐릭터 이름"
            disabled={adding}
          />
        </label>
        <button className="btn btn--primary" type="submit" disabled={adding || !displayName.trim() || !repName.trim()}>
          {adding ? '불러오는 중…' : '원정대 불러오기'}
        </button>
        {adding && <Progress label="로스트아크에서 원정대를 불러오는 중" secs={addSecs} />}
        {addError && (
          <p className="alert alert--error friends__error" role="alert">
            {addError}
          </p>
        )}
      </form>
    </div>
  );
}
