'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RAIDS } from '@/core/raids';
import type { ClearRecord, Friend, Proficiency, Role } from '@/core/types';
import { proficiencyKey } from '@/core/proficiency';
import { targetDifficultyKey } from '@/core/difficulty';
import { ApiError, api, type ClearInput } from '@/lib/api-client';
import { applyClearChange, candidateCounts, recordsAfterChange, withProficiency, withTargetDifficulty } from '@/lib/view-model';
import { createSaveQueue } from '@/lib/save-queue';
import { PasswordGate, readStoredPassword, storePassword } from '@/components/PasswordGate';
import { FriendsPanel } from '@/components/FriendsPanel';
import { CharacterCards } from '@/components/CharacterCards';
import { ALL_FILTER, ClearsFilter } from '@/components/ClearsFilter';
import { RaidPicker } from '@/components/RaidPicker';
import { PlanBoard, type PlanState } from '@/components/PlanBoard';

const CLEARS_FILTER_KEY = 'loa.clearsFilter';
const CELL_LABEL = { prof: '숙련도', diff: '가는 난이도' } as const;

/** 칸 설정 하나를 친구 목록에 반영 (null이면 지워 기본값으로). */
function applyCell(
  list: Friend[],
  c: { kind: 'prof' | 'diff'; friendId: string; characterName: string; raidName: string; value: string | null },
): Friend[] {
  return c.kind === 'prof'
    ? withProficiency(list, c.friendId, c.characterName, c.raidName, c.value as Proficiency | null)
    : withTargetDifficulty(list, c.friendId, c.characterName, c.raidName, c.value);
}

/** 서버 사본에서 칸 설정 하나를 읽는다 (정하지 않았으면 null). */
function readCell(f: Friend | undefined, kind: 'prof' | 'diff', characterName: string, raidName: string): string | null {
  return kind === 'prof'
    ? f?.proficiency?.[proficiencyKey(characterName, raidName)] ?? null
    : f?.targetDifficulty?.[targetDifficultyKey(characterName, raidName)] ?? null;
}
const message = (e: unknown) => (e instanceof Error ? e.message : '알 수 없는 오류가 났어요');

/** 다음 주간 초기화(수요일 06:00 KST)까지 남은 시간. */
function untilReset(now: Date): string {
  const KST = 9 * 3600_000;
  const k = new Date(now.getTime() + KST); // UTC 필드로 KST 시각을 읽는다
  const target = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), 6));
  let days = (3 - k.getUTCDay() + 7) % 7;
  if (days === 0 && k.getTime() >= target.getTime()) days = 7;
  const ms = target.getTime() + days * 86400_000 - k.getTime();
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / 3600_000);
  return d > 0 ? `${d}일 ${h}시간` : `${h}시간 ${Math.floor((ms % 3600_000) / 60_000)}분`;
}

export default function Home() {
  const [password, setPassword] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [clears, setClears] = useState<ClearRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [clearsFilter, setClearsFilter] = useState<string>(ALL_FILTER);
  const [version, setVersion] = useState(0);
  const [plans, setPlans] = useState<Record<string, PlanState>>({});
  const [resetIn, setResetIn] = useState<string | null>(null);

  // 클리어는 연달아 바뀔 수 있어 렌더를 기다리지 않고 최신 값을 ref로도 들고 있는다.
  const clearsRef = useRef<ClearRecord[]>([]);
  const commitClears = useCallback((next: ClearRecord[]) => {
    clearsRef.current = next;
    setClears(next);
  }, []);
  // 캐릭터별로 PUT을 하나씩 보내고, 대기 중인 변경은 최신 기록 하나로 합친다.
  const [clearQueue] = useState(() =>
    createSaveQueue<{ password: string; records: ClearInput[] }>((characterName, v) =>
      api.putClears(v.password, characterName, v.records).then(() => undefined),
    ),
  );

  /**
   * 칸(친구 × 캐릭터 × 레이드 이름) 설정: 숙련도(prof)와 가는 난이도(diff). 칸마다 하나씩 순서대로 저장하고,
   * 대기 중인 변경은 최신 값 하나로 합친다. 칸 키는 JSON 배열 문자열 (구분자가 이름과 겹치지 않게).
   */
  type CellKind = 'prof' | 'diff';
  type Cell = { kind: CellKind; friendId: string; characterName: string; raidName: string; value: string | null };
  const [cellQueue] = useState(() =>
    createSaveQueue<Cell & { password: string }>((_cell, v) =>
      (v.kind === 'prof'
        ? api.setProficiency(v.password, v.friendId, v.characterName, v.raidName, v.value as Proficiency | null)
        : api.setTargetDifficulty(v.password, v.friendId, v.characterName, v.raidName, v.value)
      ).then(() => undefined),
    ),
  );

  /**
   * pendingCells는 아직 저장이 끝나지 않은 낙관적 값으로, 서버 사본으로 친구를 바꿀 때(전투력/역할 저장 등)
   * 다시 덮어 써서 화면 값이 되돌아가지 않게 한다. cellGen은 칸별 변경 번호: 실패한 저장보다 새 변경이 시작됐으면 되돌리지 않는다.
   */
  const pendingCells = useRef(new Map<string, Cell>());
  const cellGen = useRef(new Map<string, number>());
  const withPending = useCallback((list: Friend[]): Friend[] => {
    let out = list;
    for (const p of pendingCells.current.values()) out = applyCell(out, p);
    return out;
  }, []);

  const load = useCallback(async (pw: string) => {
    const [f, c] = await Promise.all([api.listFriends(pw), api.getClears(pw)]);
    setFriends(withPending(f));
    commitClears(c);
    setLoadError(null);
  }, [commitClears, withPending]);

  /** 비밀번호가 바뀌어 401이 오면 입력창으로 돌아간다. */
  const handle = useCallback((e: unknown): string => {
    if (e instanceof ApiError && e.status === 401) {
      storePassword(null);
      setPassword(null);
      setGateMessage(e.message);
    }
    return message(e);
  }, []);

  useEffect(() => {
    setResetIn(untilReset(new Date()));
    const t = setInterval(() => setResetIn(untilReset(new Date())), 60_000);
    const stored = readStoredPassword();
    if (!stored) {
      setBooting(false);
      return () => clearInterval(t);
    }
    load(stored)
      .then(() => setPassword(stored))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          storePassword(null);
          setGateMessage(e.message);
        } else {
          setPassword(stored);
          setLoadError(message(e));
        }
      })
      .finally(() => setBooting(false));
    return () => clearInterval(t);
  }, [load]);

  const raidIds = useMemo(() => RAIDS.filter((r) => selected.includes(r.id)).map((r) => r.id), [selected]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CLEARS_FILTER_KEY);
      if (stored) setClearsFilter(stored);
    } catch {
      // 저장소를 못 쓰는 환경이어도 필터는 이번 방문 동안 동작한다.
    }
  }, []);
  // 저장된/선택한 친구가 없어졌으면(삭제 등) 전체로 본다. 표시용 필터일 뿐 참석자와는 무관하다.
  const activeFilter = friends?.some((f) => f.id === clearsFilter) ? clearsFilter : ALL_FILTER;
  function chooseClearsFilter(id: string) {
    setClearsFilter(id);
    try {
      localStorage.setItem(CLEARS_FILTER_KEY, id);
    } catch {
      // 무시
    }
  }

  const attendeeIds = useMemo(() => (friends ?? []).filter((f) => !absent.has(f.id)).map((f) => f.id), [friends, absent]);
  // 레이드 고르기 칩의 후보 수: 참석자 · 클리어 · 가는 난이도가 바뀌면 바로 다시 센다 (서버 편성과 같은 자격 규칙).
  const counts = useMemo(() => candidateCounts(friends ?? [], attendeeIds, clears), [friends, attendeeIds, clears]);
  const raidKey = raidIds.join(',');
  const attendeeKey = attendeeIds.join(',');

  // 레이드, 참석자, 친구 정보, 클리어(version)가 바뀌면 새로고침 없이 후보를 다시 불러온다.
  useEffect(() => {
    if (!password || !friends || raidIds.length === 0 || attendeeIds.length === 0) return;
    let cancelled = false;
    setPlans((prev) => {
      const next: Record<string, PlanState> = {};
      for (const id of raidIds) next[id] = { status: 'loading', data: prev[id]?.data };
      return next;
    });
    for (const id of raidIds) {
      api
        .plan(password, id, attendeeIds)
        .then((data) => {
          if (!cancelled) setPlans((p) => ({ ...p, [id]: { status: 'ready', data } }));
        })
        .catch((e) => {
          if (cancelled) return;
          const msg = handle(e);
          setPlans((p) => ({ ...p, [id]: { status: 'error', error: msg, data: p[id]?.data } }));
        });
    }
    return () => {
      cancelled = true;
    };
    // raidIds/attendeeIds 대신 raidKey/attendeeKey를 써서 내용이 바뀔 때만 다시 부른다.
  }, [password, friends, raidKey, attendeeKey, version, handle]);

  async function submitPassword(pw: string): Promise<string | null> {
    try {
      await load(pw);
      storePassword(pw);
      setPassword(pw);
      setGateMessage(null);
      return null;
    } catch (e) {
      return message(e);
    }
  }

  async function changeClear(characterName: string, raidName: string, difficulty: string) {
    if (!password) return;
    const records = recordsAfterChange(clearsRef.current, characterName, raidName, difficulty);
    commitClears(applyClearChange(clearsRef.current, characterName, records));
    setNotice(null);
    const res = await clearQueue.save(characterName, { password, records });
    if (res.ok) {
      setVersion((v) => v + 1);
      return;
    }
    // 더 새 변경이 대기 중이면 그 저장이 이 값을 대신하므로 되돌리지 않는다.
    if (res.superseded) return;
    setNotice(`${characterName}의 클리어 표시를 저장하지 못했어요: ${handle(res.error)}`);
    try {
      const server = await api.getClears(password);
      // 재조회 사이에 새 변경이 생겼으면 그 낙관적 상태를 지키고, 이 캐릭터 기록만 서버 값으로 맞춘다.
      if (clearQueue.isBusy(characterName)) return;
      const mine = server
        .filter((c) => c.characterName === characterName)
        .map(({ raidName: r, difficulty: d }) => ({ raidName: r, difficulty: d }));
      commitClears(applyClearChange(clearsRef.current, characterName, mine));
    } catch {
      /* 재조회도 실패하면 안내 문구만 남긴다 */
    }
  }

  /**
   * 칸 설정 하나를 바꾼다 (먼저 화면에 반영하고 저장은 칸별 순서대로). 실패하면 서버 값으로 되돌린다.
   * 돌려주는 값: 이 변경이 실패로 끝났으면 오류 문구, 아니면 null. quiet이면 안내 문구는 부르는 쪽이 띄운다.
   */
  async function changeCell(cell: Cell, quiet = false): Promise<string | null> {
    if (!password) return null;
    const { kind, friendId, characterName, raidName } = cell;
    const key = JSON.stringify([kind, friendId, characterName, raidName]);
    const gen = (cellGen.current.get(key) ?? 0) + 1;
    cellGen.current.set(key, gen);
    const isLatest = () => cellGen.current.get(key) === gen;
    pendingCells.current.set(key, cell);
    setFriends((prev) => (prev ? applyCell(prev, cell) : prev));
    if (!quiet) setNotice(null);
    const res = await cellQueue.save(key, { ...cell, password });
    if (isLatest()) pendingCells.current.delete(key);
    if (res.ok) {
      setVersion((v) => v + 1);
      return null;
    }
    if (res.superseded || !isLatest()) return null; // 더 새 값이 곧(또는 이미) 저장된다
    const msg = handle(res.error);
    if (!quiet) setNotice(`${characterName}의 ${raidName} ${CELL_LABEL[kind]}를 저장하지 못했어요: ${msg}`);
    try {
      const server = await api.listFriends(password);
      if (!isLatest()) return msg; // 재조회하는 사이 새 변경이 시작됐으면 그 값을 지킨다
      const saved = readCell(server.find((f) => f.id === friendId), kind, characterName, raidName);
      setFriends((prev) => (prev ? applyCell(prev, { ...cell, value: saved }) : prev));
    } catch {
      /* 재조회도 실패하면 안내 문구만 남긴다 */
    }
    return msg;
  }

  const changeProficiency = (friendId: string, characterName: string, raidName: string, level: Proficiency | null) =>
    void changeCell({ kind: 'prof', friendId, characterName, raidName, value: level });
  const changeTargetDifficulty = (friendId: string, characterName: string, raidName: string, value: string | null) =>
    void changeCell({ kind: 'diff', friendId, characterName, raidName, value });

  /** 카드 단위: 이 캐릭터의 모든 레이드 칩 숙련도를 같은 값으로 (칸마다 PUT 하나). 실패한 레이드는 모아서 알린다. */
  async function bulkProficiency(friendId: string, characterName: string, raidNames: string[], level: Proficiency) {
    setNotice(null);
    const results = await Promise.all(
      raidNames.map((raidName) => changeCell({ kind: 'prof', friendId, characterName, raidName, value: level }, true)),
    );
    const failed = raidNames.filter((_, i) => results[i] !== null);
    if (failed.length > 0) {
      const msg = results.find((r) => r !== null);
      setNotice(`${characterName}의 숙련도를 ${failed.length}개 레이드(${failed.join(', ')})에서 저장하지 못했어요: ${msg}`);
    }
  }

  /** 서버 사본으로 친구를 바꾼다. 저장 중인 숙련도 값은 다시 얹는다. */
  const replaceFriend = (f: Friend) =>
    setFriends((prev) => withPending((prev ?? []).map((x) => (x.id === f.id ? f : x))));

  async function saveCombatPower(friendId: string, characterName: string, cp: number | null) {
    if (!password) return '비밀번호가 필요해요';
    try {
      replaceFriend(await api.setCombatPower(password, friendId, characterName, cp));
      return null;
    } catch (e) {
      return handle(e);
    }
  }

  async function saveRole(friendId: string, characterName: string, role: Role | null) {
    if (!password) return '비밀번호가 필요해요';
    try {
      replaceFriend(await api.setRole(password, friendId, characterName, role));
      return null;
    } catch (e) {
      return handle(e);
    }
  }

  async function addFriend(displayName: string, representativeName: string) {
    if (!password) return '비밀번호가 필요해요';
    try {
      const f = await api.addFriend(password, displayName, representativeName);
      setFriends((prev) => [...(prev ?? []), f]);
      return null;
    } catch (e) {
      return handle(e);
    }
  }

  async function refreshFriend(id: string) {
    if (!password) return '비밀번호가 필요해요';
    try {
      replaceFriend(await api.refreshFriend(password, id));
      return null;
    } catch (e) {
      return handle(e);
    }
  }

  async function deleteFriend(id: string) {
    if (!password) return '비밀번호가 필요해요';
    const gone = friends?.find((f) => f.id === id);
    try {
      await api.deleteFriend(password, id);
    } catch (e) {
      return handle(e);
    }
    setFriends((prev) => (prev ?? []).filter((f) => f.id !== id));
    if (gone) {
      const names = new Set(gone.characters.map((c) => c.name));
      commitClears(clearsRef.current.filter((c) => !names.has(c.characterName)));
    }
    setAbsent((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    return null;
  }

  const toggleRaid = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleFriend = (id: string) =>
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (booting) {
    return (
      <main className="boot" aria-busy="true">
        <p className="muted">불러오는 중…</p>
      </main>
    );
  }
  if (!password) return <PasswordGate onSubmit={submitPassword} message={gateMessage} />;

  const logout = () => {
    storePassword(null);
    setPassword(null);
    setFriends(null);
    setPlans({});
  };

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead__inner">
          <h1 className="masthead__title">이번 주 공대</h1>
          <p className="masthead__sub">
            클리어 표시를 바꾸면 공대 후보가 바로 다시 계산돼요.
            {resetIn && (
              <>
                {' '}
                주간 초기화까지 <strong className="num">{resetIn}</strong>
              </>
            )}
          </p>
          <button type="button" className="link-btn masthead__logout" onClick={logout}>
            비밀번호 다시 입력
          </button>
        </div>
      </header>

      <main className="content">
        {loadError && (
          <div className="alert alert--error alert--block" role="alert">
            <span>{loadError}</span>
            <button type="button" className="btn btn--small" onClick={() => load(password).catch((e) => setLoadError(handle(e)))}>
              다시 시도
            </button>
          </div>
        )}

        <section className="panel" aria-labelledby="sec-friends">
          <div className="panel__head">
            <h2 id="sec-friends" className="panel__title">원정대</h2>
            <p className="panel__hint muted">친구의 대표 캐릭터만 넣으면 원정대 캐릭터를 모두 불러와요.</p>
          </div>
          {friends && friends.length === 0 && (
            <div className="empty empty--inline">
              <p className="empty__title">아직 등록된 친구가 없어요</p>
              <p className="muted">첫 친구의 이름과 대표 캐릭터를 넣어 시작하세요.</p>
            </div>
          )}
          {friends && <FriendsPanel friends={friends} onAdd={addFriend} onRefresh={refreshFriend} onDelete={deleteFriend} />}
        </section>

        {friends && friends.length > 0 && (
          <>
            <section className="panel" aria-labelledby="sec-clears">
              <div className="panel__head">
                <h2 id="sec-clears" className="panel__title">이번 주 클리어</h2>
                <p className="panel__hint muted">
                  다녀온 레이드 칩을 한 번 누르면 ✓로 바뀌고 그 캐릭터는 후보에서 빠져요. 칩 옆 ⋯에서 가는 난이도와 숙련도를 바꿀 수 있어요.
                </p>
              </div>
              {notice && (
                <p className="alert alert--error" role="alert">
                  {notice}
                </p>
              )}
              <ClearsFilter friends={friends} value={activeFilter} onChange={chooseClearsFilter} />
              <CharacterCards
                friends={activeFilter === ALL_FILTER ? friends : friends.filter((f) => f.id === activeFilter)}
                showFriendNames={activeFilter === ALL_FILTER}
                clears={clears}
                onClearChange={changeClear}
                onCombatPower={saveCombatPower}
                onRole={saveRole}
                onTargetDifficulty={changeTargetDifficulty}
                onProficiency={changeProficiency}
                onBulkProficiency={bulkProficiency}
              />
            </section>

            <section className="panel" aria-labelledby="sec-pick">
              <div className="panel__head">
                <h2 id="sec-pick" className="panel__title">레이드와 참석자</h2>
                <p className="panel__hint muted">난이도 옆 숫자는 참석하는 친구 중 그 난이도로 갈 수 있는 캐릭터 수예요. 입장 레벨은 아래 공대 후보 제목 옆에 나와요.</p>
              </div>
              <RaidPicker
                selected={selected}
                onToggleRaid={toggleRaid}
                friends={friends}
                absent={absent}
                onToggleFriend={toggleFriend}
                counts={counts}
              />
            </section>

            <section className="panel panel--plans" aria-labelledby="sec-plans">
              <div className="panel__head">
                <h2 id="sec-plans" className="panel__title">공대 후보</h2>
                <p className="panel__hint muted">평균은 딜러 전투력만 계산해요. 외부 인원은 평균에서 빠져요.</p>
              </div>
              <PlanBoard raidIds={raidIds} plans={plans} friends={friends} hasAttendees={attendeeIds.length > 0} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
