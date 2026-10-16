import { describe, it, expect, beforeEach } from 'vitest';
import type { Redis } from '@upstash/redis';
import { createMemoryStore, createUpstashStore, type Store } from '@/store/store';
import type { Friend } from '@/core/types';

// Minimal in-test fake of the Redis methods the Upstash store uses:
// get, set, del, sadd, smembers, hget, hset, hgetall, hdel
function fakeRedis(): Redis {
  const kv = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, unknown>>();
  const fake = {
    async get(k: string) { return kv.has(k) ? kv.get(k) : null; },
    async set(k: string, v: unknown) { kv.set(k, v); return 'OK'; },
    async del(...ks: string[]) {
      let n = 0;
      for (const k of ks) { n += Number(kv.delete(k)) + Number(sets.delete(k)) + Number(hashes.delete(k)); }
      return n;
    },
    async sadd(k: string, ...ms: string[]) {
      const s = sets.get(k) ?? new Set<string>(); ms.forEach((m) => s.add(m)); sets.set(k, s); return ms.length;
    },
    async smembers(k: string) { return [...(sets.get(k) ?? [])]; },
    async hget(k: string, f: string) { return hashes.get(k)?.get(f) ?? null; },
    async hset(k: string, o: Record<string, unknown>) {
      const h = hashes.get(k) ?? new Map<string, unknown>();
      for (const [f, v] of Object.entries(o)) h.set(f, v);
      hashes.set(k, h); return Object.keys(o).length;
    },
    async hgetall(k: string) {
      const h = hashes.get(k);
      return h && h.size ? Object.fromEntries(h) : null;
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
  ['upstash', () => createUpstashStore(fakeRedis())],
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
