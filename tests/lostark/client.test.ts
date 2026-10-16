import { describe, it, expect, vi } from 'vitest';
import { fetchRoster, parseItemLevel, detectRole, LostArkError } from '@/lostark/client';
import siblings from './fixtures/siblings.json';
import berserker from './fixtures/profile-berserker.json';
import artist from './fixtures/profile-artist.json';
import nocp from './fixtures/profile-nocp.json';
import { RAIDS } from '@/core/raids';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function router(overrides: Record<string, Response> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const [k, v] of Object.entries(overrides)) if (url.includes(k)) return v.clone();
    if (url.includes('/siblings')) return json(siblings.data);
    if (url.includes(encodeURIComponent('가명버서커'))) return json(berserker);
    if (url.includes(encodeURIComponent('가명도화가'))) return json(artist);
    return json(nocp);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const base = { token: 't0k', sleep: async () => {} };

describe('parseItemLevel', () => {
  it('콤마를 제거한다', () => expect(parseItemLevel('1,620.50')).toBe(1620.5));
  it('이상한 값은 0', () => expect(parseItemLevel('abc')).toBe(0));
});

describe('detectRole', () => {
  it('도화가는 support, 버서커는 dealer', () => {
    expect(detectRole('도화가', [])).toBe('support');
    expect(detectRole('버서커', [])).toBe('dealer');
  });
  it('발키리는 support (사용자 확인: 서포터 직업은 홀리나이트, 도화가, 바드, 발키리)', () => {
    expect(detectRole('발키리', [])).toBe('support');
    for (const c of ['홀리나이트', '도화가', '바드']) expect(detectRole(c, [])).toBe('support');
  });
  it('알 수 없는 직업은 dealer', () => expect(detectRole('???', ['x'])).toBe('dealer'));
});

describe('fetchRoster', () => {
  it('원정대 응답을 Character[]로 정규화한다', async () => {
    const { fetchImpl } = router();
    const r = await fetchRoster('대표', { ...base, fetchImpl });
    expect(r[0]).toEqual({ name: '가명버서커', className: '버서커', role: 'dealer', itemLevel: 1720, combatPower: 3150.25 });
    expect(r[1]).toMatchObject({ name: '가명도화가', role: 'support', itemLevel: 1710.5, combatPower: 2100 });
    expect(r[2]).toMatchObject({ role: 'dealer', itemLevel: 0, combatPower: null });
  });
  it('404/빈 응답이면 not_found', async () => {
    for (const res of [json(null, 404), json([]), json(null)]) {
      const { fetchImpl } = router({ '/siblings': res });
      await expect(fetchRoster('x', { ...base, fetchImpl })).rejects.toMatchObject({ code: 'not_found', message: '캐릭터를 찾을 수 없어요' });
    }
  });
  it('429면 rate_limited (프로필 호출 중에도)', async () => {
    const a = router({ '/siblings': json({}, 429) });
    await expect(fetchRoster('x', { ...base, fetchImpl: a.fetchImpl })).rejects.toMatchObject({ code: 'rate_limited', message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요' });
    const b = router({ '/profiles': json({}, 429) });
    await expect(fetchRoster('x', { ...base, fetchImpl: b.fetchImpl })).rejects.toBeInstanceOf(LostArkError);
    expect(b.calls.length).toBe(2); // siblings + 첫 프로필에서 중단
  });
  it('401/403이면 unauthorized', async () => {
    for (const s of [401, 403]) {
      const { fetchImpl } = router({ '/siblings': json({}, s) });
      await expect(fetchRoster('x', { ...base, fetchImpl })).rejects.toMatchObject({ code: 'unauthorized', message: '로스트아크 API 토큰이 올바르지 않아요' });
    }
  });
  it('토큰이 없으면 unauthorized', async () => {
    const { fetchImpl } = router();
    const old = process.env.LOSTARK_JWT; delete process.env.LOSTARK_JWT;
    await expect(fetchRoster('x', { sleep: base.sleep, fetchImpl })).rejects.toMatchObject({ code: 'unauthorized' });
    if (old) process.env.LOSTARK_JWT = old;
  });
  it('헤더에 authorization: bearer <token>', async () => {
    const { fetchImpl, calls } = router();
    await fetchRoster('x', { ...base, fetchImpl });
    expect((calls[0].init!.headers as Record<string, string>).authorization).toBe('bearer t0k');
  });
  it('프로필 호출 사이에 sleep 간격을 둔다', async () => {
    const sleep = vi.fn(async () => {});
    const { fetchImpl } = router();
    await fetchRoster('x', { token: 't', fetchImpl, sleep, delayMs: 700 });
    expect(sleep).toHaveBeenCalledWith(700);
    expect(sleep).toHaveBeenCalledTimes(1); // 프로필 호출 2번 사이에 한 번 (레벨 미달 캐릭터는 호출 없음)
  });
  it('가장 낮은 레이드 입장 레벨 미만인 캐릭터는 프로필을 부르지 않고 combatPower null로 남긴다', async () => {
    const minLevel = Math.min(...RAIDS.map((x) => x.minLevel));
    const rows = [
      { ServerName: '루페온', CharacterName: '본캐', CharacterClassName: '버서커', ItemAvgLevel: String(minLevel) },
      { ServerName: '루페온', CharacterName: '부캐', CharacterClassName: '바드', ItemAvgLevel: String(minLevel - 0.01) },
      { ServerName: '루페온', CharacterName: '창고', CharacterClassName: '버서커', ItemAvgLevel: '1,100.00' },
    ];
    // '/siblings'가 먼저 매치되므로 본캐 프로필 경로에만 berserker 응답이 간다
    const { fetchImpl, calls } = router({ '/siblings': json(rows), [encodeURIComponent('본캐')]: json(berserker) });
    const r = await fetchRoster('본캐', { ...base, fetchImpl });
    const profileCalls = calls.filter((c) => c.url.includes('/profiles'));
    expect(profileCalls).toHaveLength(1);
    expect(profileCalls[0].url).toContain(encodeURIComponent('본캐'));
    expect(r.map((c) => [c.name, c.role, c.combatPower])).toEqual([
      ['본캐', 'dealer', 3150.25],
      ['부캐', 'support', null],
      ['창고', 'dealer', null],
    ]);
  });
  it('개별 프로필 실패(500)는 combatPower null로 허용', async () => {
    const { fetchImpl } = router({ '/profiles': json({}, 500) });
    const r = await fetchRoster('x', { ...base, fetchImpl });
    expect(r.every((c) => c.combatPower === null)).toBe(true);
  });
});
