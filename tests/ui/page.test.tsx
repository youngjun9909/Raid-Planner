// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Home from '@/app/page';
import { PASSWORD_KEY } from '@/components/PasswordGate';
import type { Candidate, Character, ClearRecord, Friend, PlanResult } from '@/core/types';

const ch = (name: string, role: 'dealer' | 'support' = 'dealer', cp: number | null = 2500, itemLevel = 1730): Character =>
  ({ name, className: role === 'support' ? '바드' : '버서커', role, itemLevel, combatPower: cp });

const FRIENDS: Friend[] = [
  { id: 'f1', displayName: '영준', representativeName: '가나', characters: [ch('가나'), ch('가나서폿', 'support', null)] },
  { id: 'f2', displayName: '민수', representativeName: '다라', characters: [ch('다라', 'dealer', 2100)] },
];

type Call = { url: string; method: string; body: unknown; password: string | null };

let calls: Call[];
let clears: ClearRecord[];
let planResult: PlanResult;
let putResponder: ((body: { characterName: string; records: unknown[] }) => Promise<Response>) | null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  clears = [];
  planResult = { candidates: [], excluded: [] };
  putResponder = null;
  localStorage.setItem(PASSWORD_KEY, 'pw');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      const password = (init.headers as Record<string, string> | undefined)?.['x-app-password'] ?? null;
      calls.push({ url, method, body, password });
      if (url === '/api/friends' && method === 'GET') return json(FRIENDS);
      if (url === '/api/clears' && method === 'GET') return json(clears);
      if (url === '/api/clears' && method === 'PUT') return putResponder ? putResponder(body) : json({ ok: true });
      if (url === '/api/plan') return json({ ...planResult, raid: { id: body.raidId } });
      if (url.endsWith('/combat-power')) {
        const f = structuredClone(FRIENDS[0]);
        const c = f.characters.find((x) => x.name === body.characterName)!;
        if (body.cp === null) c.combatPower = c.name === '가나' ? 2500 : null;
        else Object.assign(c, { combatPower: body.cp, manualCombatPower: true });
        return json(f);
      }
      if (url.startsWith('/api/friends/') && method === 'DELETE') return json({ ok: true });
      if (url.endsWith('/role')) {
        const f = structuredClone(FRIENDS[0]);
        const c = f.characters.find((x) => x.name === body.characterName)!;
        if (body.role) Object.assign(c, { role: body.role, manualRole: true });
        return json(f);
      }
      return json({ error: 'not mocked' }, 500);
    }),
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const planCalls = () => calls.filter((c) => c.url === '/api/plan');

async function renderLoaded() {
  render(<Home />);
  await screen.findByRole('combobox', { name: '가나 세르카 클리어' });
}

describe('웹 화면', () => {
  it('친구 목록 표에 캐릭터별 레이드 체크 칸이 보인다 (캐릭터 × 레이드 이름)', async () => {
    clears = [{ characterName: '가나', raidName: '세르카', difficulty: '노말' }];
    await renderLoaded();
    for (const name of ['가나', '가나서폿', '다라']) {
      for (const raid of ['카제로스 3막 (모르둠)', '카제로스 4막 (아르모체)', '지평의 성당', '카제로스 종막 (카제로스)', '세르카', '벨가르딘']) {
        expect(screen.getByRole('combobox', { name: `${name} ${raid} 클리어` })).toBeInTheDocument();
      }
    }
    const serka = screen.getByRole('combobox', { name: '가나 세르카 클리어' }) as HTMLSelectElement;
    expect(serka.value).toBe('노말');
    expect(within(serka).getAllByRole('option').map((o) => o.textContent)).toEqual(['안 감', '노말', '하드', '나이트메어']);
    expect(calls.every((c) => c.password === 'pw')).toBe(true);
  });

  it('체크를 바꾸면 PUT /api/clears가 호출되고 공대 후보가 다시 불려온다', async () => {
    clears = [{ characterName: '가나', raidName: '벨가르딘', difficulty: '노말' }];
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 노말' }));
    await waitFor(() => expect(planCalls()).toHaveLength(1));
    expect(planCalls()[0].body).toEqual({ raidId: 'serka-normal', attendeeIds: ['f1', 'f2'] });

    fireEvent.change(screen.getByRole('combobox', { name: '가나 세르카 클리어' }), { target: { value: '하드' } });
    await waitFor(() => expect(planCalls()).toHaveLength(2));
    const put = calls.find((c) => c.url === '/api/clears' && c.method === 'PUT');
    expect(put?.body).toEqual({
      characterName: '가나',
      records: [
        { raidName: '벨가르딘', difficulty: '노말' },
        { raidName: '세르카', difficulty: '하드' },
      ],
    });
  });

  it('같은 레이드의 두 번째 난이도를 고르면 첫 번째 난이도가 해제된다', async () => {
    clears = [{ characterName: '가나', raidName: '세르카', difficulty: '노말' }];
    await renderLoaded();
    const select = screen.getByRole('combobox', { name: '가나 세르카 클리어' }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '나이트메어' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      characterName: '가나',
      records: [{ raidName: '세르카', difficulty: '나이트메어' }],
    });
    expect(select.value).toBe('나이트메어');
  });

  it('후보 카드에 분배 라벨(3+2), 공대별 평균, 단계(여유/빠듯함/위험/모름), 외부인 수가 보인다', async () => {
    const candidate: Candidate = {
      label: '3+2',
      externalCount: 3,
      imbalance: 350,
      parties: [
        {
          slots: [
            { kind: 'friend', friendId: 'f1', character: ch('가나', 'dealer', 2450) },
            { kind: 'external', role: 'support' },
          ],
          dealerAvgCP: 2450,
          tier: 'comfortable',
        },
        {
          slots: [
            { kind: 'friend', friendId: 'f2', character: ch('다라', 'dealer', 2100) },
            { kind: 'external', role: 'support' },
            { kind: 'external', role: 'dealer' },
          ],
          dealerAvgCP: 2100,
          tier: 'tight',
        },
      ],
    };
    planResult = { candidates: [candidate], excluded: [] };
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 노말' }));
    const card = await screen.findByRole('article', { name: /3\+2/ });
    const avgs = within(card).getAllByText(/^[\d,—]+$/, { selector: '.party__avg-value' }).map((e) => e.textContent);
    expect(avgs).toEqual(['2,450', '2,100']);
    expect(within(card).getByText('여유')).toBeInTheDocument();
    expect(within(card).getByText('빠듯함')).toBeInTheDocument();
    expect(within(card).getByText(/외부 3명 필요/)).toBeInTheDocument();
    expect(within(card).getAllByText('외부 서포터')).toHaveLength(2);
    expect(within(card).getByText('외부 딜러')).toBeInTheDocument();
    expect(within(card).getByText('영준')).toBeInTheDocument();
  });

  it('excluded가 있으면 "가능한 캐릭터 없음" 안내가 보인다', async () => {
    planResult = {
      candidates: [],
      excluded: [{ friendId: 'f2', reason: '가능한 캐릭터 없음' }],
      reason: '참석할 수 있는 캐릭터가 없어요',
    };
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 노말' }));
    const reason = await screen.findByText('참석할 수 있는 캐릭터가 없어요');
    const plan = reason.closest('section')!;
    expect(within(plan).getByText('민수').closest('li')).toHaveTextContent('민수 가능한 캐릭터 없음');
  });

  it('전투력이 null인 캐릭터 옆에 수동 입력칸이 있다', async () => {
    await renderLoaded();
    const input = screen.getByRole('spinbutton', { name: '가나서폿 전투력' });
    expect(screen.queryByRole('spinbutton', { name: '가나 전투력' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '1800' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/combat-power'))).toBe(true));
    const call = calls.find((c) => c.url.endsWith('/combat-power'))!;
    expect(call.url).toBe('/api/friends/f1/combat-power');
    expect(call.method).toBe('PUT');
    expect(call.body).toEqual({ characterName: '가나서폿', cp: 1800 });
    expect(await screen.findByText('1,800')).toBeInTheDocument();
  });

  it('수동 전투력에는 "수동" 표시와 자동 값으로 되돌리는 버튼이 있다', async () => {
    await renderLoaded();
    const input = screen.getByRole('spinbutton', { name: '가나서폿 전투력' });
    fireEvent.change(input, { target: { value: '1800' } });
    fireEvent.submit(input.closest('form')!);
    const reset = await screen.findByRole('button', { name: '가나서폿 전투력 자동 값으로 되돌리기' });
    expect(reset.closest('.cp')).toHaveTextContent('수동');
    expect(screen.getByRole('button', { name: '가나 전투력 수정' }).closest('.cp')).not.toHaveTextContent('수동');
    fireEvent.click(reset);
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/combat-power'))).toHaveLength(2));
    expect(calls.filter((c) => c.url.endsWith('/combat-power'))[1].body).toEqual({ characterName: '가나서폿', cp: null });
  });

  it('역할 배지를 누르면 수동 역할로 바꾸고(수동 표시), 다시 누르면 자동으로 되돌린다', async () => {
    await renderLoaded();
    const badge = screen.getByRole('button', { name: '가나 역할: 딜러 (자동). 누르면 서포터로 바꿔요' });
    expect(badge).not.toHaveTextContent('수동');
    fireEvent.click(badge);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/role'))).toBe(true));
    const call = calls.find((c) => c.url.endsWith('/role'))!;
    expect(call).toMatchObject({ url: '/api/friends/f1/role', method: 'PUT', body: { characterName: '가나', role: 'support' } });
    const manual = await screen.findByRole('button', { name: '가나 역할: 서포터 (수동). 누르면 자동으로 되돌려요' });
    expect(manual).toHaveTextContent('서포터');
    expect(manual).toHaveTextContent('수동');
    fireEvent.click(manual);
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/role'))).toHaveLength(2));
    expect(calls.filter((c) => c.url.endsWith('/role'))[1].body).toEqual({ characterName: '가나', role: null });
    expect(await screen.findByRole('button', { name: '가나 역할: 딜러 (자동). 누르면 서포터로 바꿔요' })).toBeInTheDocument();
  });

  it('친구 삭제는 확인을 한 번 더 받은 뒤 DELETE를 보내고 목록과 표에서 뺀다', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: '영준 삭제' }));
    // 아직 보내지 않는다: 확인 단계
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const confirm = screen.getByRole('group', { name: '영준 삭제 확인' });
    expect(confirm).toHaveTextContent('영준의 원정대와 이번 주 클리어 기록을 지울까요?');
    fireEvent.click(within(confirm).getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('group', { name: '영준 삭제 확인' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '영준 삭제' }));
    fireEvent.click(within(screen.getByRole('group', { name: '영준 삭제 확인' })).getByRole('button', { name: '삭제하기' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe('/api/friends/f1');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: '가나 세르카 클리어' })).not.toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: '다라 세르카 클리어' })).toBeInTheDocument();
  });

  it('저장된 비밀번호가 없으면 비밀번호 입력창을 먼저 보여 준다', async () => {
    localStorage.clear();
    render(<Home />);
    const input = await screen.findByLabelText('비밀번호');
    fireEvent.change(input, { target: { value: 'pw' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByRole('combobox', { name: '가나 세르카 클리어' });
    expect(localStorage.getItem(PASSWORD_KEY)).toBe('pw');
  });

  it('친구가 없으면 등록을 안내한다', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => json(url === '/api/friends' ? [] : []));
    render(<Home />);
    expect(await screen.findByText(/아직 등록된 친구가 없어요/)).toBeInTheDocument();
  });

  describe('같은 캐릭터의 클리어 저장 순서', () => {
    type Gate = { body: { characterName: string; records: unknown[] }; ok: () => void; fail: () => void };
    let gates: Gate[];
    let server: Record<string, unknown[]>;
    const putBodies = () => calls.filter((c) => c.url === '/api/clears' && c.method === 'PUT').map((c) => c.body);
    const clearGets = () => calls.filter((c) => c.url === '/api/clears' && c.method === 'GET');
    const select = (raid: string) => screen.getByRole('combobox', { name: `가나 ${raid} 클리어` }) as HTMLSelectElement;

    beforeEach(() => {
      gates = [];
      server = {};
      putResponder = (body) =>
        new Promise<Response>((resolve) => {
          gates.push({
            body,
            ok: () => {
              server[body.characterName] = body.records; // 응답이 도착한 순서대로 서버 상태가 바뀐다고 본다
              resolve(json({ ok: true }));
            },
            fail: () => resolve(json({ error: '저장 실패' }, 500)),
          });
        });
    });

    it('두 번 연달아 바꾸면 두 번째 저장은 첫 번째가 끝난 뒤 최신 기록 전체로 보낸다', async () => {
      await renderLoaded();
      fireEvent.change(select('세르카'), { target: { value: '노말' } });
      await waitFor(() => expect(gates).toHaveLength(1));
      fireEvent.change(select('벨가르딘'), { target: { value: '하드' } });
      await new Promise((r) => setTimeout(r, 20));
      expect(putBodies()).toHaveLength(1); // 첫 요청이 끝나기 전에는 두 번째를 보내지 않는다

      gates[0].ok();
      await waitFor(() => expect(gates).toHaveLength(2));
      gates[1].ok();
      await waitFor(() => expect(server['가나']).toHaveLength(2));
      expect(putBodies()).toEqual([
        { characterName: '가나', records: [{ raidName: '세르카', difficulty: '노말' }] },
        {
          characterName: '가나',
          records: [
            { raidName: '세르카', difficulty: '노말' },
            { raidName: '벨가르딘', difficulty: '하드' },
          ],
        },
      ]);
      expect(server['가나']).toEqual([
        { raidName: '세르카', difficulty: '노말' },
        { raidName: '벨가르딘', difficulty: '하드' },
      ]);
      expect(select('세르카').value).toBe('노말');
      expect(select('벨가르딘').value).toBe('하드');
    });

    it('첫 저장이 실패해도 대기 중인 새 변경을 서버 값으로 덮어쓰지 않는다', async () => {
      await renderLoaded();
      fireEvent.change(select('세르카'), { target: { value: '노말' } });
      await waitFor(() => expect(gates).toHaveLength(1));
      fireEvent.change(select('벨가르딘'), { target: { value: '하드' } });
      gates[0].fail();
      await waitFor(() => expect(gates).toHaveLength(2));
      expect(gates[1].body.records).toHaveLength(2);
      gates[1].ok();
      await waitFor(() => expect(server['가나']).toHaveLength(2));
      await new Promise((r) => setTimeout(r, 20));
      expect(clearGets()).toHaveLength(1); // 처음 불러온 것 말고는 되돌리기용 재조회가 없다
      expect(select('세르카').value).toBe('노말');
      expect(select('벨가르딘').value).toBe('하드');
      expect(screen.queryByText(/저장하지 못했어요/)).not.toBeInTheDocument();
    });

    it('대기 중인 변경 없이 실패하면 서버 값으로 되돌리고 안내한다', async () => {
      await renderLoaded();
      fireEvent.change(select('세르카'), { target: { value: '노말' } });
      await waitFor(() => expect(gates).toHaveLength(1));
      gates[0].fail();
      expect(await screen.findByText(/저장하지 못했어요: 저장 실패/)).toBeInTheDocument();
      await waitFor(() => expect(clearGets()).toHaveLength(2));
      await waitFor(() => expect(select('세르카').value).toBe(''));
    });
  });

  it('여러 레이드를 고르면 후보 카드 제목 id가 겹치지 않는다', async () => {
    planResult = {
      candidates: [{ label: '2', externalCount: 6, imbalance: 0, parties: [{ slots: [], dealerAvgCP: null, tier: 'unknown' }] }],
      excluded: [],
    };
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 노말' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '벨가르딘 노말' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
    const ids = screen.getAllByRole('article').map((a) => a.getAttribute('aria-labelledby')!);
    expect(new Set(ids).size).toBe(2);
    for (const a of screen.getAllByRole('article')) {
      const id = a.getAttribute('aria-labelledby')!;
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
      expect(a.querySelector(`[id="${id}"]`)).not.toBeNull();
    }
  });
});
