import { Redis } from '@upstash/redis';
import type { ClearRecord, Friend } from '@/core/types';

export interface Store {
  listFriends(): Promise<Friend[]>;
  getFriend(id: string): Promise<Friend | undefined>;
  saveFriend(f: Friend): Promise<void>;
  setManualCombatPower(friendId: string, characterName: string, cp: number | null): Promise<void>;
  getClears(week: string): Promise<ClearRecord[]>;
  setCharacterClears(week: string, characterName: string, records: Omit<ClearRecord, 'characterName'>[]): Promise<void>;
  deleteWeek(week: string): Promise<void>;
}

type Manual = Record<string, number>;
type ClearBody = Omit<ClearRecord, 'characterName'>;

function withManual(f: Friend, manual: Manual): Friend {
  return {
    ...f,
    characters: f.characters.map((c) =>
      Object.prototype.hasOwnProperty.call(manual, c.name) ? { ...c, combatPower: manual[c.name] } : { ...c },
    ),
  };
}

function mergeSaved(next: Friend, prev: Friend | undefined): Friend {
  if (!prev) return next;
  return { ...next, discordUserId: next.discordUserId ?? prev.discordUserId };
}

function flattenClears(byChar: Record<string, ClearBody[]>): ClearRecord[] {
  return Object.entries(byChar).flatMap(([characterName, recs]) =>
    recs.map((r) => ({ characterName, raidName: r.raidName, difficulty: r.difficulty })),
  );
}

export function createMemoryStore(): Store {
  const friends = new Map<string, Friend>();
  const manual = new Map<string, Manual>();
  const clears = new Map<string, Record<string, ClearBody[]>>();
  const view = (f: Friend) => withManual(structuredClone(f), manual.get(f.id) ?? {});
  return {
    async listFriends() { return [...friends.values()].map(view); },
    async getFriend(id) { const f = friends.get(id); return f ? view(f) : undefined; },
    async saveFriend(f) { friends.set(f.id, structuredClone(mergeSaved(f, friends.get(f.id)))); },
    async setManualCombatPower(friendId, name, cp) {
      const m = { ...(manual.get(friendId) ?? {}) };
      if (cp === null) delete m[name]; else m[name] = cp;
      manual.set(friendId, m);
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

// Redis methods used: get, set, del, sadd, smembers, hget, hset, hgetall, hdel
// Keys: friend:<id> (JSON), friends (set of ids), manual:<id> (hash name -> cp), clears:<week> (hash name -> JSON)
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
  const readFriend = async (id: string): Promise<Friend | undefined> =>
    parseJson<Friend>(await redis.get(`friend:${id}`));
  return {
    async listFriends() {
      const ids = ((await redis.smembers('friends')) as string[]).sort();
      const all = await Promise.all(ids.map((id) => this.getFriend(id)));
      return all.filter((f): f is Friend => f !== undefined);
    },
    async getFriend(id) {
      const f = await readFriend(id);
      return f ? withManual(f, await readManual(id)) : undefined;
    },
    async saveFriend(f) {
      const merged = mergeSaved(f, await readFriend(f.id));
      await redis.set(`friend:${f.id}`, JSON.stringify(merged));
      await redis.sadd('friends', f.id);
    },
    async setManualCombatPower(friendId, name, cp) {
      if (cp === null) await redis.hdel(`manual:${friendId}`, name);
      else await redis.hset(`manual:${friendId}`, { [name]: String(cp) });
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

let singleton: Store | undefined;
export function getStore(): Store {
  if (!singleton) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    singleton = url && token ? createUpstashStore(new Redis({ url, token })) : createMemoryStore();
  }
  return singleton;
}
