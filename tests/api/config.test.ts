import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';
import { req } from './helpers';

// 이 파일은 getStore를 목으로 바꾸지 않는다: 실제 getStore가 "프로덕션인데 저장소 env 없음"을 만나는 경우를 본다.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }));

const STORE_MSG = '저장소(Upstash Redis) 환경변수가 설정되지 않았어요. UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 을 확인해 주세요';

beforeEach(() => {
  vi.resetModules();
  for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) vi.stubEnv(k, '');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('APP_PASSWORD', 'secret');
});
afterEach(() => vi.unstubAllEnvs());

describe('프로덕션에서 저장소 env가 없으면', () => {
  it('웹 API는 503과 한글 안내 JSON (비밀 값 없음)', async () => {
    const { GET } = await import('@/app/api/friends/route');
    const res = await GET(req('/api/friends'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: STORE_MSG });
  });

  it('다른 웹 라우트도 같은 503', async () => {
    const clears = await import('@/app/api/clears/route');
    const plan = await import('@/app/api/plan/route');
    const cp = await import('@/app/api/friends/[id]/combat-power/route');
    const prof = await import('@/app/api/friends/[id]/proficiency/route');
    const diff = await import('@/app/api/friends/[id]/target-difficulty/route');
    const params = { params: Promise.resolve({ id: 'a' }) };
    for (const res of [
      await clears.GET(req('/api/clears')),
      await plan.POST(req('/api/plan', 'POST', { raidId: 'serka-hard', attendeeIds: [] })),
      await cp.PUT(req('/api/friends/a/combat-power', 'PUT', { characterName: 'x', cp: 1 }), params),
      await prof.PUT(req('/api/friends/a/proficiency', 'PUT', { characterName: 'x', raidName: '세르카', level: '숙련' }), params),
      await diff.PUT(req('/api/friends/a/target-difficulty', 'PUT', { characterName: 'x', raidName: '세르카', difficulty: '하드' }), params),
    ]) {
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe(STORE_MSG);
    }
  });

  it('크론은 503과 안내', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    const { GET } = await import('@/app/api/cron/weekly/route');
    const res = await GET(new Request('http://localhost/api/cron/weekly', { headers: { authorization: 'Bearer s3cret' } }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(STORE_MSG);
  });

  describe('디스코드', () => {
    const keys = nacl.sign.keyPair();
    const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
    function signed(body: unknown): Request {
      const raw = JSON.stringify(body);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sig = nacl.sign.detached(new TextEncoder().encode(timestamp + raw), keys.secretKey);
      return new Request('http://localhost/api/discord', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature-ed25519': hex(sig), 'x-signature-timestamp': timestamp },
        body: raw,
      });
    }
    beforeEach(() => vi.stubEnv('DISCORD_PUBLIC_KEY', hex(keys.publicKey)));

    it('명령어에는 본인에게만 보이는 안내 메시지로 답한다', async () => {
      const { POST } = await import('@/app/api/discord/route');
      const res = await POST(signed({ type: 2, token: 't', application_id: 'app', member: { user: { id: 'u' } }, data: { name: '현황' } }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.type).toBe(4);
      expect(json.data.flags).toBe(64);
      expect(JSON.stringify(json)).toContain(STORE_MSG);
    });

    it('자동완성은 저장소 없이 빈 선택지(type 8)로 답한다', async () => {
      const { POST } = await import('@/app/api/discord/route');
      const res = await POST(signed({ type: 4, token: 't', application_id: 'app', member: { user: { id: 'u' } }, data: { name: '숙련도', options: [] } }));
      expect(await res.json()).toEqual({ type: 8, data: { choices: [] } });
    });

    it('PING은 저장소 없이도 PONG', async () => {
      const { POST } = await import('@/app/api/discord/route');
      expect(await (await POST(signed({ type: 1 }))).json()).toEqual({ type: 1 });
    });
  });
});
