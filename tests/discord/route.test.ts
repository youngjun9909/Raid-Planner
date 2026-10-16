import { describe, it, expect, beforeAll, vi } from 'vitest';
import nacl from 'tweetnacl';
import { POST } from '@/app/api/discord/route';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }));

const keys = nacl.sign.keyPair();
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

beforeAll(() => { process.env.DISCORD_PUBLIC_KEY = hex(keys.publicKey); });

function signed(body: unknown, opts: { badSig?: boolean } = {}): Request {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = nacl.sign.detached(new TextEncoder().encode(timestamp + raw), keys.secretKey);
  if (opts.badSig) sig[0] ^= 0xff;
  return new Request('http://localhost/api/discord', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature-ed25519': hex(sig), 'x-signature-timestamp': timestamp },
    body: raw,
  });
}

describe('POST /api/discord', () => {
  it('route: 서명이 틀리면 401 [Review Focus 5]', async () => {
    const res = await POST(signed({ type: 1 }, { badSig: true }));
    expect(res.status).toBe(401);
  });

  it('서명 헤더가 없으면 401', async () => {
    const res = await POST(new Request('http://localhost/api/discord', { method: 'POST', body: '{"type":1}' }));
    expect(res.status).toBe(401);
  });

  it('route: PING(type 1)에 {type:1}로 응답', async () => {
    const res = await POST(signed({ type: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('올바른 서명의 명령어는 200과 handleInteraction 결과', async () => {
    const res = await POST(signed({ type: 2, token: 't', application_id: 'app', member: { user: { id: 'u' } }, data: { name: '명령어' } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
  });

  it('자동완성(type 4)도 서명을 검사하고, 맞으면 type 8 선택지로 응답한다', async () => {
    const body = {
      type: 4, token: 't', application_id: 'app', member: { user: { id: 'u' } },
      data: { name: '숙련도', options: [{ name: '캐릭터', type: 3, value: '', focused: true }] },
    };
    expect((await POST(signed(body, { badSig: true }))).status).toBe(401);
    const res = await POST(signed(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 8, data: { choices: [] } });
  });

  it('/등록은 type 5로 응답하고 후속 작업을 after()로 예약한다', async () => {
    const { after } = await import('next/server');
    const res = await POST(signed({
      type: 2, token: 't', application_id: 'app', member: { user: { id: 'u' } },
      data: { name: '등록', options: [{ name: '대표캐릭터', type: 3, value: 'X' }] },
    }));
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(after).toHaveBeenCalledWith(expect.any(Function));
  });
});
