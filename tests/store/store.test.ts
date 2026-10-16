import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Redis } from '@upstash/redis';
import { createMemoryStore, createUpstashStore, type Store } from '@/store/store';
import type { Friend } from '@/core/types';

// Minimal in-test fake of the Redis methods the Upstash store uses:
// get, set, del, sadd, smembers, hget, hset, hgetall, hdel
// autoParse mimics the real client: JSON-parses string values (incl. numeric-looking set members) on read.
function fakeRedis(autoParse = false): Redis {
  const out = (v: unknown): unknown => {
    if (!autoParse || typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
  };
  const kv = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, unknown>>();
  const fake = {
    async get(k: string) { return kv.has(k) ? out(kv.get(k)) : null; },
    async set(k: string, v: unknown) { kv.set(k, v); return 'OK'; },
    async del(...ks: string[]) {
      let n = 0;
      for (const k of ks) { n += Number(kv.delete(k)) + Number(sets.delete(k)) + Number(hashes.delete(k)); }
      return n;
    },
    async sadd(k: string, ...ms: string[]) {
      const s = sets.get(k) ?? new Set<string>(); ms.forEach((m) => s.add(m)); sets.set(k, s); return ms.length;
    },
    async smembers(k: string) { return [...(sets.get(k) ?? [])].map(out); },
    async hget(k: string, f: string) { return out(hashes.get(k)?.get(f) ?? null); },
    async hset(k: string, o: Record<string, unknown>) {
      const h = hashes.get(k) ?? new Map<string, unknown>();
      for (const [f, v] of Object.entries(o)) h.set(f, v);
      hashes.set(k, h); return Object.keys(o).length;
    },
    async hgetall(k: string) {
      const h = hashes.get(k);
      return h && h.size ? Object.fromEntries([...h].map(([f, v]) => [f, out(v)])) : null;
    },
    async hdel(k: string, ...fs: string[]) {
      const h = hashes.get(k); if (!h) return 0;
      let n = 0; for (const f of fs) n += Number(h.delete(f));
      if (!h.size) hashes.delete(k);
      return n;
    },
  };
  return fake as unknown as Redis;
}

const friend = (over: Partial<Friend> = {}): Friend => ({
  id: 'f1', displayName: 'A', representativeName: 'Alpha',
  characters: [
    { name: 'Alpha', className: 'Berserker', role: 'dealer', itemLevel: 1700, combatPower: 3000 },
    { name: 'Beta', className: 'Bard', role: 'support', itemLevel: 1690, combatPower: null },
  ],
  ...over,
});

describe.each([
  ['memory', () => createMemoryStore()],
  ['upstash', () => createUpstashStore(fakeRedis(false))],
  ['upstash autoParse', () => createUpstashStore(fakeRedis(true))],
] as [string, () => Store][])('Store contract (%s)', (_n, make) => {
  let s: Store;
  beforeEach(() => { s = make(); });

  it('saveFriend 후 listFriends/getFriend로 읽힌다', async () => {
    expect(await s.listFriends()).toEqual([]);
    expect(await s.getFriend('f1')).toBeUndefined();
    await s.saveFriend(friend());
    expect(await s.getFriend('f1')).toEqual(friend());
    expect(await s.listFriends()).toEqual([friend()]);
  });

  it('setManualCombatPower가 API 값보다 우선하고, null로 지우면 원래 값으로 돌아간다', async () => {
    await s.saveFriend(friend());
    await s.setManualCombatPower('f1', 'Alpha', 5000);
    await s.setManualCombatPower('f1', 'Beta', 2000);
    const f = await s.getFriend('f1');
    expect(f!.characters.map((c) => c.combatPower)).toEqual([5000, 2000]);
    expect((await s.listFriends())[0].characters[0].combatPower).toBe(5000);
    await s.setManualCombatPower('f1', 'Alpha', null);
    await s.setManualCombatPower('f1', 'Beta', null);
    expect((await s.getFriend('f1'))!.characters.map((c) => c.combatPower)).toEqual([3000, null]);
  });

  it('saveFriend는 기존 수동 전투력과 discordUserId를 유지한다', async () => {
    await s.saveFriend(friend({ discordUserId: 'd1' }));
    await s.setManualCombatPower('f1', 'Alpha', 5000);
    await s.saveFriend(friend({ displayName: 'B' }));
    const f = (await s.getFriend('f1'))!;
    expect(f.displayName).toBe('B');
    expect(f.discordUserId).toBe('d1');
    expect(f.characters[0].combatPower).toBe(5000);
    await s.saveFriend(friend({ discordUserId: 'd2' }));
    expect((await s.getFriend('f1'))!.discordUserId).toBe('d2');
  });

  it('setCharacterClears는 해당 캐릭터의 기록을 교체하고 다른 캐릭터는 건드리지 않는다', async () => {
    await s.setCharacterClears('w1', 'Alpha', [{ raidName: 'R1', difficulty: 'n' }, { raidName: 'R2', difficulty: 'h' }]);
    await s.setCharacterClears('w1', 'Beta', [{ raidName: 'R1', difficulty: 'n' }]);
    await s.setCharacterClears('w1', 'Alpha', [{ raidName: 'R3', difficulty: 'n' }]);
    const c = await s.getClears('w1');
    expect(c).toHaveLength(2);
    expect(c).toContainEqual({ characterName: 'Alpha', raidName: 'R3', difficulty: 'n' });
    expect(c).toContainEqual({ characterName: 'Beta', raidName: 'R1', difficulty: 'n' });
    await s.setCharacterClears('w1', 'Alpha', []);
    expect(await s.getClears('w1')).toEqual([{ characterName: 'Beta', raidName: 'R1', difficulty: 'n' }]);
  });

  it('주(week)가 다르면 클리어 기록이 분리된다', async () => {
    await s.setCharacterClears('w1', 'Alpha', [{ raidName: 'R1', difficulty: 'n' }]);
    expect(await s.getClears('w2')).toEqual([]);
    expect(await s.getClears('w1')).toHaveLength(1);
  });

  it('deleteWeek 후 getClears는 []', async () => {
    await s.setCharacterClears('w1', 'Alpha', [{ raidName: 'R1', difficulty: 'n' }]);
    await s.deleteWeek('w1');
    expect(await s.getClears('w1')).toEqual([]);
  });
});

describe('Upstash store with auto-deserializing client', () => {
  it('숫자형 문자열 friend id도 listFriends/getFriend로 읽힌다', async () => {
    const s = createUpstashStore(fakeRedis(true));
    await s.saveFriend(friend({ id: '123456' }));
    expect((await s.getFriend('123456'))!.id).toBe('123456');
    expect((await s.listFriends()).map((f) => f.id)).toEqual(['123456']);
  });

  it('구조분해한 메서드도 this 없이 동작한다', async () => {
    const { saveFriend, listFriends } = createUpstashStore(fakeRedis(true));
    await saveFriend(friend());
    expect(await listFriends()).toHaveLength(1);
  });
});

describe('memory store copies', () => {
  it('반환된 Friend를 변경해도 저장 상태는 바뀌지 않는다', async () => {
    const s = createMemoryStore();
    await s.saveFriend(friend());
    const f = (await s.getFriend('f1'))!;
    f.displayName = 'X'; f.characters[0].name = 'Y';
    (await s.listFriends())[0].characters.pop();
    expect(await s.getFriend('f1')).toEqual(friend());
  });
});

describe('getStore', () => {
  const saved = { u: process.env.UPSTASH_REDIS_REST_URL, t: process.env.UPSTASH_REDIS_REST_TOKEN };
  beforeEach(() => {
    // 실행 환경에 어떤 값이 있든 매트릭스를 명확히: 기본은 "로컬 개발, 저장소 env 없음"
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('NODE_ENV', 'test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    if (saved.u === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = saved.u;
    if (saved.t === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = saved.t;
    vi.doUnmock('@upstash/redis');
    vi.resetModules();
  });
  const fresh = async () => {
    const ctor = vi.fn();
    vi.resetModules();
    vi.doMock('@upstash/redis', () => ({ Redis: ctor }));
    return { ctor, m: await import('@/store/store') };
  };

  it('UPSTASH 이름이 없으면 KV_REST_API_URL/TOKEN(Vercel Marketplace)을 쓴다', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example.invalid'); vi.stubEnv('KV_REST_API_TOKEN', 'kvtok');
    vi.stubEnv('VERCEL', '1');
    const { ctor, m } = await fresh();
    m.getStore();
    expect(ctor).toHaveBeenCalledWith({ url: 'https://kv.example.invalid', token: 'kvtok' });
  });

  it('두 이름이 다 있으면 UPSTASH_REDIS_REST_* 가 우선', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://u.example.invalid'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'utok');
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example.invalid'); vi.stubEnv('KV_REST_API_TOKEN', 'kvtok');
    const { ctor, m } = await fresh();
    m.getStore();
    expect(ctor).toHaveBeenCalledWith({ url: 'https://u.example.invalid', token: 'utok' });
  });

  it.each([
    ['VERCEL=1', { VERCEL: '1' }],
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
  ])('저장소 env가 없고 %s 이면 한글 안내와 함께 throw (메모리로 조용히 넘어가지 않는다)', async (_n, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { ctor, m } = await fresh();
    expect(() => m.getStore()).toThrow(m.StoreConfigError);
    expect(() => m.getStore()).toThrow('저장소(Upstash Redis) 환경변수가 설정되지 않았어요. UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 을 확인해 주세요');
    expect(ctor).not.toHaveBeenCalled();
  });

  it('URL만 있고 토큰이 없으면 설정이 없는 것으로 본다 (프로덕션이면 throw)', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://u.example.invalid'); vi.stubEnv('VERCEL', '1');
    const { m } = await fresh();
    expect(() => m.getStore()).toThrow(m.StoreConfigError);
  });

  it('env가 없으면 메모리 저장소이고 같은 인스턴스를 돌려준다', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const ctor = vi.fn();
    vi.resetModules();
    vi.doMock('@upstash/redis', () => ({ Redis: ctor }));
    const m = await import('@/store/store');
    const a = m.getStore();
    expect(m.getStore()).toBe(a);
    expect(ctor).not.toHaveBeenCalled();
    await a.saveFriend(friend());
    expect(await a.listFriends()).toHaveLength(1);
  });

  it('env가 있으면 Upstash 저장소를 한 번만 만든다', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.invalid'; process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    const ctor = vi.fn();
    vi.resetModules();
    vi.doMock('@upstash/redis', () => ({ Redis: ctor }));
    const m = await import('@/store/store');
    const a = m.getStore();
    expect(m.getStore()).toBe(a);
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(ctor).toHaveBeenCalledWith({ url: 'https://example.invalid', token: 'tok' });
  });
});
