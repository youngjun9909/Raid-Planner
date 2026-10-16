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
afterEach(() => { delete process.env.APP_PASSWORD; });

describe('checkPassword', () => {
  it('올바른 비밀번호만 통과', () => {
    expect(checkPassword(req('/x', 'GET', undefined, 'secret'))).toBe(true);
    expect(checkPassword(req('/x', 'GET', undefined, 'wrong'))).toBe(false);
    expect(checkPassword(req('/x', 'GET', undefined, 'secre'))).toBe(false);
    expect(checkPassword(req('/x', 'GET', undefined, null))).toBe(false);
  });
  it('APP_PASSWORD가 없으면 통과', () => {
    delete process.env.APP_PASSWORD;
    expect(checkPassword(req('/x', 'GET', undefined, null))).toBe(true);
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
