import { Redis } from '@upstash/redis';
import type { Character, ClearRecord, Friend, Proficiency, Role } from '@/core/types';
import { isProficiency, proficiencyKey } from '@/core/proficiency';
import { isTargetDifficultyFor, raidNameOfKey, targetDifficultyKey } from '@/core/difficulty';
import { isProduction } from '@/lib/env';

export interface Store {
  listFriends(): Promise<Friend[]>;
  getFriend(id: string): Promise<Friend | undefined>;
  saveFriend(f: Friend): Promise<void>;
  setManualCombatPower(friendId: string, characterName: string, cp: number | null): Promise<void>;
  /** 캐릭터 역할 수동 지정. null이면 지정을 지워 자동 판별로 돌아간다. */
  setManualRole(friendId: string, characterName: string, role: Role | null): Promise<void>;
  /**
   * 캐릭터 × 레이드 이름의 숙련도. null이면 지워 기본값(반숙)으로 돌아간다. 로스터를 다시 저장해도 남는다.
   * 읽을 때 friend.proficiency(`<캐릭터>|<레이드>` → 숙련도)로 붙는다.
   */
  setProficiency(friendId: string, characterName: string, raidName: string, level: Proficiency | null): Promise<void>;
  /**
   * 캐릭터 × 레이드 이름의 가는 난이도 (난이도 이름 또는 `안 감`). null이면 지워 자동 기본값으로 돌아간다.
   * 숙련도와 같은 방식: 로스터를 다시 저장해도 남고, 읽을 때 friend.targetDifficulty로 붙는다. 값 검사는 호출하는 쪽(API)이 한다.
   */
  setTargetDifficulty(friendId: string, characterName: string, raidName: string, value: string | null): Promise<void>;
  /**
   * 친구를 지운다: friend:<id>, friends 집합의 id, 수동 전투력/역할, 숙련도, 가는 난이도, 그리고 week 주에 기록된
   * 그 친구 캐릭터들의 클리어. 지난 주 기록은 주간 작업이 지운다. 없는 친구면 false.
   * (저장소는 시각을 모르므로 이번 주 key는 호출하는 쪽이 weekKey(now)로 넘긴다.)
   */
  deleteFriend(id: string, week: string): Promise<boolean>;
  getClears(week: string): Promise<ClearRecord[]>;
  setCharacterClears(week: string, characterName: string, records: Omit<ClearRecord, 'characterName'>[]): Promise<void>;
  deleteWeek(week: string): Promise<void>;
}

type Manual = Record<string, number>;
type ManualRoles = Record<string, Role>;
type Profs = Record<string, Proficiency>;
type Diffs = Record<string, string>;
type ClearBody = Omit<ClearRecord, 'characterName'>;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isRole = (v: unknown): v is Role => v === 'support' || v === 'dealer';

/** 저장된 가는 난이도 중 올바른 값만 (모르는 레이드, 그 레이드에 없는 난이도, 문자열 아님은 버린다). */
function validDiffs(raw: Record<string, unknown>): Diffs {
  const out: Diffs = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.includes('|') && isTargetDifficultyFor(raidNameOfKey(k), v)) out[k] = v;
  }
  return out;
}

/**
 * 수동 전투력/역할을 덮어쓰고 수동 표시를 붙인다. 수동 값이 API 값보다 우선한다.
 * 숙련도가 있으면 proficiency로, 가는 난이도가 있으면 targetDifficulty로 붙인다.
 */
function withManual(f: Friend, manual: Manual, roles: ManualRoles = {}, profs: Profs = {}, diffs: Diffs = {}): Friend {
  const { proficiency: _p, targetDifficulty: _d, ...rest } = f;
  const d = validDiffs(diffs);
  return {
    ...rest,
    ...(Object.keys(profs).length ? { proficiency: { ...profs } } : {}),
    ...(Object.keys(d).length ? { targetDifficulty: d } : {}),
    characters: f.characters.map((c) => {
      const out: Character = { ...c };
      if (has(manual, c.name)) Object.assign(out, { combatPower: manual[c.name], manualCombatPower: true });
      if (has(roles, c.name)) Object.assign(out, { role: roles[c.name], manualRole: true });
      return out;
    }),
  };
}

/** 저장 직전: 읽을 때만 붙는 수동 표시, 숙련도, 가는 난이도는 버린다. */
function stripMarks({ proficiency: _p, targetDifficulty: _d, ...f }: Friend): Friend {
  return {
    ...f,
    characters: f.characters.map(({ manualCombatPower: _cp, manualRole: _role, ...c }) => c),
  };
}

function mergeSaved(next: Friend, prev: Friend | undefined): Friend {
  const clean = stripMarks(next);
  if (!prev) return clean;
  return { ...clean, discordUserId: clean.discordUserId ?? prev.discordUserId };
}

function flattenClears(byChar: Record<string, ClearBody[]>): ClearRecord[] {
  return Object.entries(byChar).flatMap(([characterName, recs]) =>
    recs.map((r) => ({ characterName, raidName: r.raidName, difficulty: r.difficulty })),
  );
}

export function createMemoryStore(): Store {
  const friends = new Map<string, Friend>();
  const manual = new Map<string, Manual>();
  const roles = new Map<string, ManualRoles>();
  const profs = new Map<string, Profs>();
  const diffs = new Map<string, Diffs>();
  const clears = new Map<string, Record<string, ClearBody[]>>();
  const view = (f: Friend) => withManual(structuredClone(f), manual.get(f.id) ?? {}, roles.get(f.id) ?? {}, profs.get(f.id) ?? {}, diffs.get(f.id) ?? {});
  return {
    async listFriends() { return [...friends.values()].map(view); },
    async getFriend(id) { const f = friends.get(id); return f ? view(f) : undefined; },
    async saveFriend(f) { friends.set(f.id, structuredClone(mergeSaved(f, friends.get(f.id)))); },
    async setManualCombatPower(friendId, name, cp) {
      const m = { ...(manual.get(friendId) ?? {}) };
      if (cp === null) delete m[name]; else m[name] = cp;
      manual.set(friendId, m);
    },
    async setManualRole(friendId, name, role) {
      const m = { ...(roles.get(friendId) ?? {}) };
      if (role === null) delete m[name]; else m[name] = role;
      roles.set(friendId, m);
    },
    async setProficiency(friendId, name, raidName, level) {
      const m = { ...(profs.get(friendId) ?? {}) };
      const key = proficiencyKey(name, raidName);
      if (level === null) delete m[key]; else m[key] = level;
      profs.set(friendId, m);
    },
    async setTargetDifficulty(friendId, name, raidName, value) {
      const m = { ...(diffs.get(friendId) ?? {}) };
      const key = targetDifficultyKey(name, raidName);
      if (value === null) delete m[key]; else m[key] = value;
      diffs.set(friendId, m);
    },
    async deleteFriend(id, week) {
      const f = friends.get(id);
      if (!f) return false;
      friends.delete(id);
      manual.delete(id);
      roles.delete(id);
      profs.delete(id);
      diffs.delete(id);
      const w = { ...(clears.get(week) ?? {}) };
      for (const c of f.characters) delete w[c.name];
      clears.set(week, w);
      return true;
    },
    async getClears(week) { return flattenClears(structuredClone(clears.get(week) ?? {})); },
    async setCharacterClears(week, name, records) {
      const w = { ...(clears.get(week) ?? {}) };
      if (records.length === 0) delete w[name]; else w[name] = records.map((r) => ({ raidName: r.raidName, difficulty: r.difficulty }));
      clears.set(week, w);
    },
    async deleteWeek(week) { clears.delete(week); },
  };
}

// Parse a value that may be a JSON string or an already-parsed value (auto-deserializing client).
function parseJson<T>(v: unknown): T | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return undefined; }
  }
  return v as T;
}

// Redis methods used: get, set, del, sadd, srem, smembers, hget, hset, hgetall, hdel
// Keys: friend:<id> (JSON), friends (set of ids), manual:<id> (hash name -> cp),
//       role:<id> (hash name -> 'support'|'dealer'), prof:<id> (hash '<name>|<raidName>' -> '숙련'|'반숙'|'클경'),
//       diff:<id> (hash '<name>|<raidName>' -> 난이도 이름 | '안 감'), clears:<week> (hash name -> JSON)
export function createUpstashStore(redis: Redis): Store {
  const readManual = async (id: string): Promise<Manual> => {
    const raw = (await redis.hgetall(`manual:${id}`)) as Record<string, unknown> | null;
    const out: Manual = {};
    for (const [k, v] of Object.entries(raw ?? {})) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  };
  const readRoles = async (id: string): Promise<ManualRoles> => {
    const raw = (await redis.hgetall(`role:${id}`)) as Record<string, unknown> | null;
    const out: ManualRoles = {};
    for (const [k, v] of Object.entries(raw ?? {})) if (isRole(v)) out[k] = v;
    return out;
  };
  const readProfs = async (id: string): Promise<Profs> => {
    const raw = (await redis.hgetall(`prof:${id}`)) as Record<string, unknown> | null;
    const out: Profs = {};
    for (const [k, v] of Object.entries(raw ?? {})) if (isProficiency(v)) out[k] = v;
    return out;
  };
  const readDiffs = async (id: string): Promise<Diffs> =>
    validDiffs(((await redis.hgetall(`diff:${id}`)) as Record<string, unknown> | null) ?? {});
  const readFriend = async (id: string): Promise<Friend | undefined> =>
    parseJson<Friend>(await redis.get(`friend:${id}`));
  const getFriend = async (id: string): Promise<Friend | undefined> => {
    const f = await readFriend(id);
    if (!f) return undefined;
    const [manual, roles, profs, diffs] = await Promise.all([readManual(id), readRoles(id), readProfs(id), readDiffs(id)]);
    return withManual(f, manual, roles, profs, diffs);
  };
  const listFriends = async (): Promise<Friend[]> => {
    // auto-deserializing clients may return numeric-looking ids as numbers; ids are only
    // used in key template literals, so that is harmless (covered by the numeric-id test)
    const ids = ((await redis.smembers('friends')) as string[]).sort();
    const all = await Promise.all(ids.map(getFriend));
    return all.filter((f): f is Friend => f !== undefined);
  };
  return {
    listFriends,
    getFriend,
    async saveFriend(f) {
      const merged = mergeSaved(f, await readFriend(f.id));
      await redis.set(`friend:${f.id}`, JSON.stringify(merged));
      await redis.sadd('friends', f.id);
    },
    async setManualCombatPower(friendId, name, cp) {
      if (cp === null) await redis.hdel(`manual:${friendId}`, name);
      else await redis.hset(`manual:${friendId}`, { [name]: String(cp) });
    },
    async setManualRole(friendId, name, role) {
      if (role === null) await redis.hdel(`role:${friendId}`, name);
      else await redis.hset(`role:${friendId}`, { [name]: role });
    },
    async setProficiency(friendId, name, raidName, level) {
      const key = proficiencyKey(name, raidName);
      if (level === null) await redis.hdel(`prof:${friendId}`, key);
      else await redis.hset(`prof:${friendId}`, { [key]: level });
    },
    async setTargetDifficulty(friendId, name, raidName, value) {
      const key = targetDifficultyKey(name, raidName);
      if (value === null) await redis.hdel(`diff:${friendId}`, key);
      else await redis.hset(`diff:${friendId}`, { [key]: value });
    },
    async deleteFriend(id, week) {
      const f = await readFriend(id);
      if (!f) return false;
      const names = f.characters.map((c) => c.name);
      if (names.length) await redis.hdel(`clears:${week}`, ...names);
      await redis.del(`manual:${id}`, `role:${id}`, `prof:${id}`, `diff:${id}`);
      await redis.srem('friends', id);
      await redis.del(`friend:${id}`);
      return true;
    },
    async getClears(week) {
      const raw = (await redis.hgetall(`clears:${week}`)) as Record<string, unknown> | null;
      const byChar: Record<string, ClearBody[]> = {};
      for (const [name, v] of Object.entries(raw ?? {})) byChar[name] = parseJson<ClearBody[]>(v) ?? [];
      return flattenClears(byChar);
    },
    async setCharacterClears(week, name, records) {
      if (records.length === 0) await redis.hdel(`clears:${week}`, name);
      else {
        const body = records.map((r) => ({ raidName: r.raidName, difficulty: r.difficulty }));
        await redis.hset(`clears:${week}`, { [name]: JSON.stringify(body) });
      }
    },
    async deleteWeek(week) { await redis.del(`clears:${week}`); },
  };
}

export const STORE_CONFIG_MESSAGE =
  '저장소(Upstash Redis) 환경변수가 설정되지 않았어요. UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 을 확인해 주세요';

/** 배포 환경에서 저장소 env가 없을 때. 메시지는 고정 문구라 비밀 값이 섞이지 않는다. */
export class StoreConfigError extends Error {
  constructor() {
    super(STORE_CONFIG_MESSAGE);
    this.name = 'StoreConfigError';
  }
}

/** UPSTASH_REDIS_REST_* 를 먼저 보고, 없으면 Vercel Marketplace가 넣는 KV_REST_API_* 를 쓴다. 두 쌍을 섞지 않는다. */
function redisEnv(): { url: string; token: string } | undefined {
  const pairs: [string | undefined, string | undefined][] = [
    [process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN],
    [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN],
  ];
  for (const [url, token] of pairs) if (url && token) return { url, token };
  return undefined;
}

let singleton: Store | undefined;
/**
 * Upstash 설정이 있으면 Upstash, 없으면 로컬 개발/테스트용 메모리 저장소.
 * 배포 환경(VERCEL 또는 NODE_ENV=production)에서 설정이 없으면 StoreConfigError를 던진다:
 * 인스턴스마다 메모리가 따로라 데이터가 사라지고 웹/디스코드가 서로 다른 값을 보게 되기 때문.
 */
export function getStore(): Store {
  if (!singleton) {
    const env = redisEnv();
    if (env) singleton = createUpstashStore(new Redis(env));
    else if (isProduction()) throw new StoreConfigError();
    else singleton = createMemoryStore();
  }
  return singleton;
}
