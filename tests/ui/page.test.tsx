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
      if (url === '/api/friends' && method === 'POST')
        return json({ id: 'f3', displayName: body.displayName, representativeName: body.representativeName, characters: [ch(body.representativeName)] });
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

  // 영준(f1): 가나 + 가나서폿 두 캐릭터로 1공대·2공대에, 민수(f2): 다라로 1공대에만
  const multiRun: Candidate = {
    summary: { friendCount: 2, characterCount: 3, partyCount: 2, externalCount: 5, externalSupports: 1, externalDealers: 4 },
    imbalance: 350,
    parties: [
      {
        slots: [
          { kind: 'friend', friendId: 'f1', character: ch('가나', 'dealer', 2450) },
          { kind: 'friend', friendId: 'f2', character: ch('다라', 'dealer', 2100) },
          { kind: 'external', role: 'support' },
          { kind: 'external', role: 'dealer' },
        ],
        dealerAvgCP: 2275,
        tier: 'comfortable',
      },
      {
        slots: [
          { kind: 'friend', friendId: 'f1', character: ch('가나서폿', 'support', null) },
          { kind: 'external', role: 'dealer' },
          { kind: 'external', role: 'dealer' },
          { kind: 'external', role: 'dealer' },
        ],
        dealerAvgCP: null,
        tier: 'unknown',
      },
    ],
  };
  const friendsOnly: Candidate = {
    summary: { friendCount: 2, characterCount: 2, partyCount: 1, externalCount: 0, externalSupports: 0, externalDealers: 0 },
    imbalance: 0,
    parties: [{
      slots: [
        { kind: 'friend', friendId: 'f1', character: ch('가나서폿', 'support', null) },
        { kind: 'friend', friendId: 'f2', character: ch('다라', 'dealer', 2100) },
      ],
      dealerAvgCP: 2100,
      tier: 'tight',
    }],
  };

  it('추천 카드: "추천 N"(첫 번째에 ⭐), 요약 한 줄, 공대가 카드 안에 1공대·2공대 순서로 쌓인다', async () => {
    planResult = { candidates: [multiRun, friendsOnly], excluded: [] };
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 노말' }));
    const first = await screen.findByRole('article', { name: /추천 1/ });
    const second = screen.getByRole('article', { name: /추천 2/ });
    expect(within(first).getByRole('heading', { level: 4 })).toHaveTextContent('⭐추천 1');
    expect(within(second).getByRole('heading', { level: 4 })).toHaveTextContent(/^추천 2$/);
    expect(within(first).getByText('친구 2명 · 캐릭터 3개 · 공대 2개 · 외부 5명 필요 (서포터 1, 딜러 4)')).toBeInTheDocument();
    expect(within(second).getByText('친구 2명 · 캐릭터 2개 · 공대 1개 · 친구들만으로 구성 가능')).toBeInTheDocument();
    // 공대는 카드 안에 1공대, 2공대 순서로. 공대 영역 이름은 추천 번호를 넣어 페이지 안에서 겹치지 않는다
    const parties = within(first).getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(parties).toEqual(['추천 1 1공대', '추천 1 2공대']);
    expect(within(second).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['추천 2 1공대']);
    expect(within(first).getAllByText(/^\d공대$/).map((e) => e.textContent)).toEqual(['1공대', '2공대']);
    const avgs = within(first).getAllByText(/^[\d,—]+$/, { selector: '.party__avg-value' }).map((e) => e.textContent);
    expect(avgs).toEqual(['2,275', '—']);
    expect(within(first).getByText('여유')).toBeInTheDocument();
    expect(within(first).getByText('모름')).toBeInTheDocument();
    expect(within(first).getAllByText('외부 서포터')).toHaveLength(1);
    expect(within(first).getAllByText('외부 딜러')).toHaveLength(4);
    // 같은 친구(영준)가 두 공대에 다른 캐릭터로 나온다
    const [p1, p2] = within(first).getAllByRole('region');
    expect(within(p1).getByText('영준')).toBeInTheDocument();
    expect(within(p1).getByText('가나')).toBeInTheDocument();
    expect(within(p2).getByText('영준')).toBeInTheDocument();
    expect(within(p2).getByText('가나서폿')).toBeInTheDocument();
    expect(within(first).getByText('공대 간 딜러 평균 차이 350')).toBeInTheDocument();
    // "분배"라는 말은 어디에도 없다
    expect(document.body.textContent).not.toMatch(/분배/);
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
      candidates: [friendsOnly, multiRun],
      excluded: [],
    };
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 노말' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '벨가르딘 노말' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(4));
    const ids = screen.getAllByRole('article').map((a) => a.getAttribute('aria-labelledby')!);
    expect(new Set(ids).size).toBe(4);
    for (const a of screen.getAllByRole('article')) {
      const id = a.getAttribute('aria-labelledby')!;
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
      expect(a.querySelector(`[id="${id}"]`)).not.toBeNull();
    }
  });
});

describe('이번 주 클리어 친구 필터', () => {
  const FILTER_KEY = 'loa.clearsFilter';
  const chip = (name: RegExp | string) => screen.getByRole('button', { name });
  const filterGroup = () => screen.getByRole('group', { name: '친구별로 보기' });

  it('전체 + 친구별 칩이 캐릭터 수와 함께 button/aria-pressed로 보인다', async () => {
    await renderLoaded();
    const buttons = within(filterGroup()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['전체 3', '영준 2', '민수 1']);
    expect(within(filterGroup()).getByRole('button', { name: /^전체/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(filterGroup()).getByRole('button', { name: /^영준/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('친구 칩을 누르면 그 친구 캐릭터만, 전체를 누르면 모두 보인다', async () => {
    await renderLoaded();
    fireEvent.click(within(filterGroup()).getByRole('button', { name: /^민수/ }));
    expect(screen.getByRole('combobox', { name: '다라 세르카 클리어' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '가나 세르카 클리어' })).not.toBeInTheDocument();
    expect(within(filterGroup()).getByRole('button', { name: /^민수/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(filterGroup()).getByRole('button', { name: /^전체/ }));
    expect(screen.getByRole('combobox', { name: '가나 세르카 클리어' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '다라 세르카 클리어' })).toBeInTheDocument();
  });

  it('필터를 골라도 참석자와 공대 요청은 바뀌지 않는다', async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    await waitFor(() => expect(planCalls().length).toBeGreaterThan(0));
    const before = planCalls().length;
    const checked = () => screen.getAllByRole('checkbox').map((x) => (x as HTMLInputElement).checked);
    const snapshot = checked();
    fireEvent.click(within(filterGroup()).getByRole('button', { name: /^민수/ }));
    expect(checked()).toEqual(snapshot);
    await new Promise((r) => setTimeout(r, 50));
    expect(planCalls().length).toBe(before);
  });

  it('새로 등록한 친구도 칩이 생기고, 선택한 친구를 삭제하면 전체로 돌아간다', async () => {
    await renderLoaded();
    fireEvent.change(screen.getByPlaceholderText('예: 영준'), { target: { value: '철수' } });
    fireEvent.change(screen.getByPlaceholderText('게임 속 캐릭터 이름'), { target: { value: '마바' } });
    fireEvent.click(screen.getByRole('button', { name: '원정대 불러오기' }));
    await within(filterGroup()).findByRole('button', { name: /^철수/ });
    fireEvent.click(within(filterGroup()).getByRole('button', { name: /^영준/ }));
    fireEvent.click(screen.getByRole('button', { name: '영준 삭제' }));
    fireEvent.click(within(screen.getByRole('group', { name: '영준 삭제 확인' })).getByRole('button', { name: '삭제하기' }));
    await waitFor(() => expect(within(filterGroup()).queryByRole('button', { name: /^영준/ })).not.toBeInTheDocument());
    expect(within(filterGroup()).getByRole('button', { name: /^전체/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: '다라 세르카 클리어' })).toBeInTheDocument();
  });

  it('저장된 필터를 적용하고, 선택 시 저장한다', async () => {
    localStorage.setItem(FILTER_KEY, 'f2');
    render(<Home />);
    await screen.findByRole('combobox', { name: '다라 세르카 클리어' });
    expect(screen.queryByRole('combobox', { name: '가나 세르카 클리어' })).not.toBeInTheDocument();
    fireEvent.click(within(filterGroup()).getByRole('button', { name: /^영준/ }));
    expect(localStorage.getItem(FILTER_KEY)).toBe('f1');
  });

  it('저장된 값이 없는 친구를 가리키면 무시한다', async () => {
    localStorage.setItem(FILTER_KEY, 'ghost');
    await renderLoaded();
    expect(screen.getByRole('combobox', { name: '다라 세르카 클리어' })).toBeInTheDocument();
    expect(within(filterGroup()).getByRole('button', { name: /^전체/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('저장소가 오류를 던져도 화면은 동작한다', async () => {
    const orig = Storage.prototype.getItem;
    const origSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function (k: string) {
      if (k === FILTER_KEY) throw new Error('blocked');
      return orig.call(this, k);
    };
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === FILTER_KEY) throw new Error('blocked');
      return origSet.call(this, k, v);
    };
    try {
      await renderLoaded();
      fireEvent.click(within(filterGroup()).getByRole('button', { name: /^민수/ }));
      expect(screen.queryByRole('combobox', { name: '가나 세르카 클리어' })).not.toBeInTheDocument();
    } finally {
      Storage.prototype.getItem = orig;
      Storage.prototype.setItem = origSet;
    }
  });

  it('그룹 안에서 전투력 높은 순으로 보이고 전투력 없는 캐릭터는 뒤에 온다', async () => {
    FRIENDS[0].characters = [ch('낮음', 'dealer', 100), ch('없음', 'dealer', null, 1800), ch('높음', 'dealer', 3000)];
    try {
      render(<Home />);
      await screen.findByRole('combobox', { name: '높음 세르카 클리어' });
      const names = screen.getAllByRole('combobox')
        .map((s) => s.getAttribute('aria-label')!)
        .filter((l) => l.endsWith('세르카 클리어'))
        .map((l) => l.split(' ')[0]);
      expect(names).toEqual(['높음', '낮음', '없음', '다라']);
    } finally {
      FRIENDS[0].characters = [ch('가나'), ch('가나서폿', 'support', null)];
    }
  });
});
