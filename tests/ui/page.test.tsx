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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  clears = [];
  planResult = { candidates: [], excluded: [] };
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
      if (url === '/api/clears' && method === 'PUT') return json({ ok: true });
      if (url === '/api/plan') return json({ ...planResult, raid: { id: body.raidId } });
      if (url.endsWith('/combat-power')) {
        const f = structuredClone(FRIENDS[0]);
        f.characters[1].combatPower = body.cp;
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
});
