import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryStore, type Store } from '@/store/store';
import { checkPassword } from '@/lib/auth';
import { GET as getFriends } from '@/app/api/friends/route';
import { GET as getClears } from '@/app/api/clears/route';
import { POST as postPlan } from '@/app/api/plan/route';
import { req } from './helpers';

let store: Store;
vi.mock('@/store/store', async (orig) => ({ ...(await orig<typeof import('@/store/store')>()), getStore: () => store }));

beforeEach(() => { store = createMemoryStore(); process.env.APP_PASSWORD = 'secret'; });
afterEach(() => { delete process.env.APP_PASSWORD; vi.unstubAllEnvs(); });

describe('checkPassword', () => {
  it('올바른 비밀번호만 통과', () => {
    expect(checkPassword(req('/x', 'GET', undefined, 'secret'))).toBe(true);
    expect(checkPassword(req('/x', 'GET', undefined, 'wrong'))).toBe(false);
    expect(checkPassword(req('/x', 'GET', undefined, 'secre'))).toBe(false);
    expect(checkPassword(req('/x', 'GET', undefined, null))).toBe(false);
  });
  it('APP_PASSWORD가 없으면 로컬 개발에서만 통과', () => {
    delete process.env.APP_PASSWORD;
    vi.stubEnv('VERCEL', ''); vi.stubEnv('NODE_ENV', 'test');
    expect(checkPassword(req('/x', 'GET', undefined, null))).toBe(true);
  });
  it.each([
    ['VERCEL=1', { VERCEL: '1', NODE_ENV: 'test' }],
    ['NODE_ENV=production', { VERCEL: '', NODE_ENV: 'production' }],
  ])('APP_PASSWORD가 없고 %s 이면 통과시키지 않는다', (_n, env) => {
    delete process.env.APP_PASSWORD;
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    expect(checkPassword(req('/x', 'GET', undefined, null))).toBe(false);
    expect(checkPassword(req('/x', 'GET', undefined, 'anything'))).toBe(false);
  });
});

describe('배포 환경에서 APP_PASSWORD가 없으면 503', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('보호된 모든 라우트가 503과 설정 안내', async () => {
    delete process.env.APP_PASSWORD;
    vi.stubEnv('VERCEL', '1');
    for (const res of [
      await getFriends(req('/api/friends', 'GET', undefined, null)),
      await getClears(req('/api/clears', 'GET', undefined, 'whatever')),
      await postPlan(req('/api/plan', 'POST', { raidId: 'x', attendeeIds: [] }, null)),
    ]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'APP_PASSWORD를 설정해 주세요' });
    }
  });
  it('로컬 개발에서는 비밀번호 없이 열린다', async () => {
    delete process.env.APP_PASSWORD;
    vi.stubEnv('VERCEL', ''); vi.stubEnv('NODE_ENV', 'development');
    expect((await getFriends(req('/api/friends', 'GET', undefined, null))).status).toBe(200);
  });
});

describe('비밀번호가 틀리면 401', () => {
  it('모든 라우트가 401', async () => {
    for (const res of [
      await getFriends(req('/api/friends', 'GET', undefined, 'bad')),
      await getClears(req('/api/clears', 'GET', undefined, null)),
      await postPlan(req('/api/plan', 'POST', { raidId: 'x', attendeeIds: [] }, 'bad')),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: '비밀번호가 올바르지 않아요' });
    }
  });
});
