import type { ClearRecord, Friend, PlanResult, Proficiency, RaidConfig, Role } from '@/core/types';

/** API 오류. message는 서버가 보낸 한글 안내, status 0은 네트워크 오류. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export type PlanResponse = PlanResult & { raid: RaidConfig };
export type ClearInput = { raidName: string; difficulty: string };

async function call<T>(password: string, url: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-app-password': password };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && typeof data.error === 'string' ? data.error : `요청이 실패했어요 (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

const friendUrl = (id: string, action: string) => `/api/friends/${encodeURIComponent(id)}/${action}`;

export const api = {
  listFriends: (pw: string) => call<Friend[]>(pw, '/api/friends'),
  addFriend: (pw: string, displayName: string, representativeName: string) =>
    call<Friend>(pw, '/api/friends', 'POST', { displayName, representativeName }),
  deleteFriend: (pw: string, id: string) => call<{ ok: true }>(pw, `/api/friends/${encodeURIComponent(id)}`, 'DELETE'),
  refreshFriend: (pw: string, id: string) => call<Friend>(pw, friendUrl(id, 'refresh'), 'POST'),
  setCombatPower: (pw: string, id: string, characterName: string, cp: number | null) =>
    call<Friend>(pw, friendUrl(id, 'combat-power'), 'PUT', { characterName, cp }),
  setRole: (pw: string, id: string, characterName: string, role: Role | null) =>
    call<Friend>(pw, friendUrl(id, 'role'), 'PUT', { characterName, role }),
  /** 숙련도 (raidName은 난이도 없는 레이드 이름). null이면 기본값 반숙으로. */
  setProficiency: (pw: string, id: string, characterName: string, raidName: string, level: Proficiency | null) =>
    call<Friend>(pw, friendUrl(id, 'proficiency'), 'PUT', { characterName, raidName, level }),
  /** 가는 난이도 (raidName은 난이도 없는 레이드 이름, difficulty는 그 레이드의 난이도 또는 '안 감'). null이면 자동으로. */
  setTargetDifficulty: (pw: string, id: string, characterName: string, raidName: string, difficulty: string | null) =>
    call<Friend>(pw, friendUrl(id, 'target-difficulty'), 'PUT', { characterName, raidName, difficulty }),
  getClears: (pw: string) => call<ClearRecord[]>(pw, '/api/clears'),
  putClears: (pw: string, characterName: string, records: ClearInput[]) =>
    call<{ ok: true }>(pw, '/api/clears', 'PUT', { characterName, records }),
  plan: (pw: string, raidId: string, attendeeIds: string[]) =>
    call<PlanResponse>(pw, '/api/plan', 'POST', { raidId, attendeeIds }),
};
