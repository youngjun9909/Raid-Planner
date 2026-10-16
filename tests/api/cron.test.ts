import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/weekly/route';
import { runWeekly } from '@/lib/weekly';
import { createMemoryStore } from '@/store/store';
import { LostArkError } from '@/lostark/client';
import { weekKey } from '@/core/week';
import { ch, friend } from './helpers';

const NOW = new Date('2026-10-14T00:00:00Z'); // 수요일 09:00 KST
const THIS_WEEK = weekKey(NOW);
const LAST_WEEK = weekKey(new Date(NOW.getTime() - 7 * 86400000));

const cronReq = (auth?: string) =>
  new Request('http://localhost/api/cron/weekly', { headers: auth ? { authorization: auth } : {} });

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/cron/weekly 인증', () => {
  it('CRON_SECRET이 다르면 401', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect((await GET(cronReq('Bearer wrong'))).status).toBe(401);
    expect((await GET(cronReq('Bearer s3cret2'))).status).toBe(401);
  });
  it('헤더가 없으면 401', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect((await GET(cronReq())).status).toBe(401);
  });
  it('CRON_SECRET이 설정되지 않으면 항상 401 (fail closed)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(cronReq('Bearer '))).status).toBe(401);
    expect((await GET(cronReq('Bearer undefined'))).status).toBe(401);
    expect((await GET(cronReq())).status).toBe(401);
  });
});

describe('runWeekly', () => {
  it('지난주 기록만 삭제하고 이번 주 기록은 남긴다', async () => {
    const store = createMemoryStore();
    await store.setCharacterClears(LAST_WEEK, 'A', [{ raidName: '세르카', difficulty: '하드' }]);
    await store.setCharacterClears(THIS_WEEK, 'A', [{ raidName: '세르카', difficulty: '하드' }]);
    const res = await runWeekly({ store, fetchRoster: async () => [], now: () => NOW });
    expect(res.deletedWeek).toBe(LAST_WEEK);
    expect(await store.getClears(LAST_WEEK)).toEqual([]);
    expect(await store.getClears(THIS_WEEK)).toHaveLength(1);
  });

  it('로스터를 갱신하고 수동 전투력과 discordUserId를 유지한다', async () => {
    const store = createMemoryStore();
    await store.saveFriend({ ...friend('f1', [ch('A', 'dealer', null)]), discordUserId: 'd1' });
    await store.setManualCombatPower('f1', 'A', 4000);
    const res = await runWeekly({ store, fetchRoster: async () => [ch('A', 'dealer', null), ch('B')], now: () => NOW });
    expect(res).toMatchObject({ refreshed: 1, failed: [] });
    const f = (await store.getFriend('f1'))!;
    expect(f.characters.map((c) => c.name)).toEqual(['A', 'B']);
    expect(f.characters[0].combatPower).toBe(4000);
    expect(f.discordUserId).toBe('d1');
  });

  it('한 친구의 갱신이 실패해도 나머지는 갱신된다', async () => {
    const store = createMemoryStore();
    await store.saveFriend(friend('f1', [ch('A')]));
    await store.saveFriend(friend('f2', [ch('B')]));
    await store.saveFriend(friend('f3', [ch('C')]));
    const fetchRoster = vi.fn(async (name: string) => {
      if (name === 'B') throw new LostArkError('not_found');
      return [ch(name), ch(name + '2')];
    });
    const res = await runWeekly({ store, fetchRoster, now: () => NOW });
    expect(res.refreshed).toBe(2);
    expect(res.failed).toEqual([{ friendId: 'f2', error: '캐릭터를 찾을 수 없어요' }]);
    expect((await store.getFriend('f3'))!.characters).toHaveLength(2);
    expect((await store.getFriend('f2'))!.characters).toHaveLength(1);
  });

  it('요청 제한(rate_limited)이면 나머지를 멈추고 보고한다', async () => {
    const store = createMemoryStore();
    await store.saveFriend(friend('f1', [ch('A')]));
    await store.saveFriend(friend('f2', [ch('B')]));
    await store.saveFriend(friend('f3', [ch('C')]));
    let n = 0;
    const fetchRoster = vi.fn(async (name: string) => {
      if (++n === 2) throw new LostArkError('rate_limited');
      return [ch(name)];
    });
    const res = await runWeekly({ store, fetchRoster, now: () => NOW });
    expect(fetchRoster).toHaveBeenCalledTimes(2);
    expect(res.refreshed).toBe(1);
    expect(res.failed).toHaveLength(2);
    expect(res.failed.every((x) => x.error === 'rate_limited')).toBe(true);
    // 갱신된 친구 + 실패한 친구 = 전체
    const byName: Record<string, string> = { A: 'f1', B: 'f2', C: 'f3' };
    const first = byName[fetchRoster.mock.calls[0][0]];
    expect(new Set([first, ...res.failed.map((x) => x.friendId)])).toEqual(new Set(['f1', 'f2', 'f3']));
  });

  describe('공정한 갱신 순서 (주차마다 시작 위치를 돌린다)', () => {
    const setup = async (count: number) => {
      const store = createMemoryStore();
      for (let i = 0; i < count; i++) await store.saveFriend(friend(`f${i}`, [ch(`N${i}`)]));
      return store;
    };
    const order = async (now: Date, count = 5) => {
      const store = await setup(count);
      const fetchRoster = vi.fn(async (name: string) => [ch(name)]);
      const res = await runWeekly({ store, fetchRoster, now: () => now });
      return { names: fetchRoster.mock.calls.map((c) => c[0] as string), res };
    };

    it('같은 주에는 항상 같은 순서이고, 한 번 끝까지 돌면 모든 친구를 한 번씩 갱신한다', async () => {
      const a = await order(NOW);
      const b = await order(new Date(NOW.getTime() + 3600_000)); // 같은 주
      expect(a.names).toEqual(b.names);
      expect([...a.names].sort()).toEqual(['N0', 'N1', 'N2', 'N3', 'N4']);
      expect(a.res).toMatchObject({ refreshed: 5, failed: [] });
      // 순서는 정렬된 목록을 한 칸씩 돌린 것
      for (let i = 1; i < 5; i++) expect(a.names[i]).toBe(`N${(Number(a.names[0].slice(1)) + i) % 5}`);
    });

    it('주가 바뀌면 시작하는 친구가 달라진다 (같은 친구만 늘 뒤로 밀리지 않음)', async () => {
      const firsts = new Set<string>();
      for (let w = 0; w < 8; w++) firsts.add((await order(new Date(NOW.getTime() + w * 7 * 86400000))).names[0]);
      expect(firsts.size).toBeGreaterThan(1);
    });
  });

  it('요약에 토큰이나 예외 원문이 들어가지 않는다', async () => {
    const store = createMemoryStore();
    await store.saveFriend(friend('f1', [ch('A')]));
    const fetchRoster = async () => { throw new Error('bearer eyJSECRET.TOKEN failed'); };
    const res = await runWeekly({ store, fetchRoster, now: () => NOW });
    expect(JSON.stringify(res)).not.toMatch(/eyJ|bearer|SECRET/i);
    expect(res.failed).toHaveLength(1);
  });
});

describe('maxDuration', () => {
  it('주간 크론은 300초, 원정대 조회 라우트는 60초', async () => {
    expect((await import('@/app/api/cron/weekly/route')).maxDuration).toBe(300);
    expect((await import('@/app/api/friends/route')).maxDuration).toBe(60);
    expect((await import('@/app/api/friends/[id]/refresh/route')).maxDuration).toBe(60);
  });
});

describe('vercel.json', () => {
  it('주간 크론을 수요일 06:00 KST(화 21:00 UTC)에 등록한다', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(cfg.crons).toEqual([{ path: '/api/cron/weekly', schedule: '0 21 * * 2' }]);
  });
});
