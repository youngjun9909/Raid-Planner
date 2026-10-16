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
let profResponder: ((body: { characterName: string; raidName: string; level: string | null }) => Promise<Response>) | null;
let diffResponder: ((body: { characterName: string; raidName: string; difficulty: string | null }) => Promise<Response>) | null;
/** 처음 불러오기 다음의 GET /api/friends 응답 (되돌리기용 재조회를 늦추는 데 쓴다). */
let friendsResponder: (() => Promise<Response>) | null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  clears = [];
  planResult = { candidates: [], excluded: [] };
  putResponder = null;
  profResponder = null;
  diffResponder = null;
  friendsResponder = null;
  localStorage.setItem(PASSWORD_KEY, 'pw');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      const password = (init.headers as Record<string, string> | undefined)?.['x-app-password'] ?? null;
      calls.push({ url, method, body, password });
      if (url === '/api/friends' && method === 'GET') {
        const first = calls.filter((c) => c.url === '/api/friends' && c.method === 'GET').length === 1;
        return !first && friendsResponder ? friendsResponder() : json(FRIENDS);
      }
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
      if (url.endsWith('/proficiency')) return profResponder ? profResponder(body) : json(FRIENDS[0]);
      if (url.endsWith('/target-difficulty')) return diffResponder ? diffResponder(body) : json(FRIENDS[0]);
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
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 레이드 칩(클리어 토글 버튼). 이름은 "가나 세르카 하드: 미완" / "가나 세르카 노말: 갔음" / "가나 세르카: 안 감". */
const chipName = (char: string, raid: string) => new RegExp(`^${esc(char)} ${esc(raid)}( \\S+)?: `);
const chip = (char: string, raid: string) => screen.getByRole('button', { name: chipName(char, raid) });
const queryChip = (char: string, raid: string) => screen.queryByRole('button', { name: chipName(char, raid) });
const settingsBtn = (char: string, raid: string) => screen.getByRole('button', { name: new RegExp(`^${esc(char)} ${esc(raid)} 설정`) });
const openSettings = (char: string, raid: string) => fireEvent.click(settingsBtn(char, raid));
// 기본 픽스처(아이템 레벨 1730)가 갈 수 있는 레이드 이름 (벨가르딘은 1750부터라 칩이 없다)
const RAIDS_1730 = ['카제로스 3막 (모르둠)', '카제로스 4막 (아르모체)', '지평의 성당', '카제로스 종막 (카제로스)', '세르카'];

async function renderLoaded() {
  render(<Home />);
  await screen.findByRole('button', { name: chipName('가나', '세르카') });
}

describe('웹 화면', () => {
  it('캐릭터 카드마다 갈 수 있는 레이드 이름에만 칩이 있고, 칩에 가는 난이도(또는 간 난이도 ✓)가 보인다', async () => {
    clears = [{ characterName: '가나', raidName: '세르카', difficulty: '노말' }];
    await renderLoaded();
    for (const name of ['가나', '가나서폿', '다라']) {
      const list = screen.getByRole('list', { name: `${name} 레이드` });
      // 칩(aria-pressed가 있는 버튼)은 갈 수 있는 레이드 이름마다 하나, 설정 순서로
      const toggles = within(list).getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
      expect(toggles.map((b) => b.getAttribute('aria-label')!.replace(/ \S+: .*$/, ''))).toEqual(RAIDS_1730.map((r) => `${name} ${r}`));
      // 칩마다 설정(⋯) 버튼이 하나
      expect(within(list).getAllByRole('button', { name: / 설정/ })).toHaveLength(RAIDS_1730.length);
      expect(queryChip(name, '벨가르딘')).toBeNull(); // 1730은 벨가르딘(1750)을 못 간다
    }
    const serka = chip('가나', '세르카');
    expect(serka).toHaveAccessibleName('가나 세르카 노말: 갔음'); // 가는 난이도(하드)와 달라도 간 난이도로 ✓
    expect(serka).toHaveAttribute('aria-pressed', 'true');
    expect(serka).toHaveTextContent('✓세르카 · 노말');
    const armoche = chip('가나', '카제로스 4막 (아르모체)');
    expect(armoche).toHaveAccessibleName('가나 카제로스 4막 (아르모체) 하드: 미완'); // 자동 기본값 = 입장 가능한 가장 높은 난이도
    expect(armoche).toHaveAttribute('aria-pressed', 'false');
    expect(armoche).toHaveTextContent('○카제로스 4막 (아르모체) · 하드');
    expect(chip('가나', '지평의 성당')).toHaveAccessibleName('가나 지평의 성당 2단계: 미완');
    expect(calls.every((c) => c.password === 'pw')).toBe(true);
  });

  it('칩을 한 번 누르면 가는 난이도로 클리어를 기록하고(캐릭터의 전체 기록으로 PUT) 공대 후보를 다시 불러온다', async () => {
    clears = [{ characterName: '가나', raidName: '벨가르딘', difficulty: '노말' }];
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 하드' }));
    await waitFor(() => expect(planCalls()).toHaveLength(1));
    expect(planCalls()[0].body).toEqual({ raidId: 'serka-hard', attendeeIds: ['f1', 'f2'] });

    fireEvent.click(chip('가나', '세르카'));
    await waitFor(() => expect(planCalls()).toHaveLength(2));
    const put = calls.find((c) => c.url === '/api/clears' && c.method === 'PUT');
    expect(put?.body).toEqual({
      characterName: '가나',
      records: [
        { raidName: '벨가르딘', difficulty: '노말' },
        { raidName: '세르카', difficulty: '하드' },
      ],
    });
    expect(chip('가나', '세르카')).toHaveAccessibleName('가나 세르카 하드: 갔음');
    expect(chip('가나', '세르카')).toHaveAttribute('aria-pressed', 'true');
  });

  it('다른 난이도로 간 칩을 누르면 그 기록을 지우고, 다시 누르면 가는 난이도 하나만 남는다 (한 레이드는 한 난이도)', async () => {
    clears = [{ characterName: '가나', raidName: '세르카', difficulty: '노말' }];
    await renderLoaded();
    fireEvent.click(chip('가나', '세르카'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ characterName: '가나', records: [] });
    expect(chip('가나', '세르카')).toHaveAccessibleName('가나 세르카 하드: 미완');
    fireEvent.click(chip('가나', '세르카'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'PUT')[1].body).toEqual({
      characterName: '가나',
      records: [{ raidName: '세르카', difficulty: '하드' }],
    });
    expect(chip('가나', '세르카')).toHaveAccessibleName('가나 세르카 하드: 갔음');
  });

  it('1700 미만 캐릭터는 응답에 섞여 있어도 카드와 필터 수에 나오지 않는다', async () => {
    FRIENDS[0].characters = [ch('가나'), ch('가나서폿', 'support', null), ch('낮은캐', 'dealer', 9999, 1690)];
    try {
      await renderLoaded();
      expect(screen.queryByText('낮은캐')).toBeNull();
      expect(screen.queryByRole('list', { name: '낮은캐 레이드' })).toBeNull();
      expect(within(screen.getByRole('group', { name: '친구별로 보기' })).getByRole('button', { name: /^영준/ })).toHaveTextContent('영준 2');
    } finally {
      FRIENDS[0].characters = [ch('가나'), ch('가나서폿', 'support', null)];
    }
  });

  // 영준(f1): 가나 + 가나서폿 두 캐릭터로 1공대·2공대에, 민수(f2): 다라로 1공대에만
  const multiRun: Candidate = {
    summary: { friendCount: 2, characterCount: 3, partyCount: 2, externalCount: 5, externalSupports: 1, externalDealers: 4, friendThreshold: 1 },
    kind: 'recommended', imbalance: 350, unplaced: [],
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
    summary: { friendCount: 2, characterCount: 2, partyCount: 1, externalCount: 0, externalSupports: 0, externalDealers: 0, friendThreshold: 1 },
    kind: 'recommended', imbalance: 0, unplaced: [],
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
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 하드' }));
    const first = await screen.findByRole('article', { name: /추천 1/ });
    const second = screen.getByRole('article', { name: /추천 2/ });
    expect(within(first).getByRole('heading', { level: 4 })).toHaveTextContent('⭐추천 1');
    expect(within(second).getByRole('heading', { level: 4 })).toHaveTextContent(/^추천 2$/);
    expect(within(first).getByText('친구 2명 · 캐릭터 3개 편성 · 공대 2개 · 외부 5명 필요 (서포터 1, 딜러 4)')).toBeInTheDocument();
    expect(within(second).getByText('친구 2명 · 캐릭터 2개 편성 · 공대 1개 · 친구들만으로 구성 가능')).toBeInTheDocument();
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

  it('"숙련자 없음" 경고는 계획 응답의 proficiencyTracked가 true일 때만 보인다', async () => {
    planResult = { candidates: [friendsOnly], excluded: [] };
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 하드' }));
    const card = await screen.findByRole('article', { name: /추천 1/ });
    expect(within(card).getByText('숙련 0 · 반숙 2 · 클경 0')).toBeInTheDocument();
    expect(within(card).queryByText('숙련자 없음')).toBeNull();
    cleanup();
    planResult = { candidates: [friendsOnly], excluded: [], proficiencyTracked: true };
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 하드' }));
    const tracked = await screen.findByRole('article', { name: /추천 1/ });
    expect(within(tracked).getByText('숙련자 없음')).toBeInTheDocument();
  });

  it('excluded가 있으면 "가능한 캐릭터 없음" 안내가 보인다', async () => {
    planResult = {
      candidates: [],
      excluded: [{ friendId: 'f2', reason: '가능한 캐릭터 없음' }],
      reason: '참석할 수 있는 캐릭터가 없어요',
    };
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 하드' }));
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
    await waitFor(() => expect(queryChip('가나', '세르카')).not.toBeInTheDocument());
    expect(chip('다라', '세르카')).toBeInTheDocument();
  });

  it('저장된 비밀번호가 없으면 비밀번호 입력창을 먼저 보여 준다', async () => {
    localStorage.clear();
    render(<Home />);
    const input = await screen.findByLabelText('비밀번호');
    fireEvent.change(input, { target: { value: 'pw' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByRole('button', { name: chipName('가나', '세르카') });
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

    it('두 칩을 연달아 누르면 두 번째 저장은 첫 번째가 끝난 뒤 최신 기록 전체로 보낸다', async () => {
      await renderLoaded();
      fireEvent.click(chip('가나', '세르카'));
      await waitFor(() => expect(gates).toHaveLength(1));
      fireEvent.click(chip('가나', '지평의 성당'));
      await new Promise((r) => setTimeout(r, 20));
      expect(putBodies()).toHaveLength(1); // 첫 요청이 끝나기 전에는 두 번째를 보내지 않는다

      gates[0].ok();
      await waitFor(() => expect(gates).toHaveLength(2));
      gates[1].ok();
      await waitFor(() => expect(server['가나']).toHaveLength(2));
      expect(putBodies()).toEqual([
        { characterName: '가나', records: [{ raidName: '세르카', difficulty: '하드' }] },
        {
          characterName: '가나',
          records: [
            { raidName: '세르카', difficulty: '하드' },
            { raidName: '지평의 성당', difficulty: '2단계' },
          ],
        },
      ]);
      expect(server['가나']).toEqual([
        { raidName: '세르카', difficulty: '하드' },
        { raidName: '지평의 성당', difficulty: '2단계' },
      ]);
      expect(chip('가나', '세르카')).toHaveAttribute('aria-pressed', 'true');
      expect(chip('가나', '지평의 성당')).toHaveAccessibleName('가나 지평의 성당 2단계: 갔음');
    });

    it('같은 칩을 빠르게 두 번 누르면 하나씩 순서대로 보내고 마지막 상태(해제)로 끝난다', async () => {
      await renderLoaded();
      fireEvent.click(chip('가나', '세르카'));
      await waitFor(() => expect(gates).toHaveLength(1));
      fireEvent.click(chip('가나', '세르카'));
      expect(chip('가나', '세르카')).toHaveAttribute('aria-pressed', 'false'); // 먼저 화면에 반영
      await new Promise((r) => setTimeout(r, 20));
      expect(gates).toHaveLength(1);
      gates[0].ok();
      await waitFor(() => expect(gates).toHaveLength(2));
      gates[1].ok();
      await waitFor(() => expect(server['가나']).toEqual([]));
      expect(putBodies()).toEqual([
        { characterName: '가나', records: [{ raidName: '세르카', difficulty: '하드' }] },
        { characterName: '가나', records: [] },
      ]);
      expect(chip('가나', '세르카')).toHaveAccessibleName('가나 세르카 하드: 미완');
    });

    it('첫 저장이 실패해도 대기 중인 새 변경을 서버 값으로 덮어쓰지 않는다', async () => {
      await renderLoaded();
      fireEvent.click(chip('가나', '세르카'));
      await waitFor(() => expect(gates).toHaveLength(1));
      fireEvent.click(chip('가나', '지평의 성당'));
      gates[0].fail();
      await waitFor(() => expect(gates).toHaveLength(2));
      expect(gates[1].body.records).toHaveLength(2);
      gates[1].ok();
      await waitFor(() => expect(server['가나']).toHaveLength(2));
      await new Promise((r) => setTimeout(r, 20));
      expect(clearGets()).toHaveLength(1); // 처음 불러온 것 말고는 되돌리기용 재조회가 없다
      expect(chip('가나', '세르카')).toHaveAttribute('aria-pressed', 'true');
      expect(chip('가나', '지평의 성당')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByText(/저장하지 못했어요/)).not.toBeInTheDocument();
    });

    it('대기 중인 변경 없이 실패하면 서버 값으로 되돌리고 안내한다', async () => {
      await renderLoaded();
      fireEvent.click(chip('가나', '세르카'));
      await waitFor(() => expect(gates).toHaveLength(1));
      expect(chip('가나', '세르카')).toHaveAttribute('aria-pressed', 'true');
      gates[0].fail();
      expect(await screen.findByText(/가나의 클리어 표시를 저장하지 못했어요: 저장 실패/)).toBeInTheDocument();
      await waitFor(() => expect(clearGets()).toHaveLength(2));
      await waitFor(() => expect(chip('가나', '세르카')).toHaveAttribute('aria-pressed', 'false'));
    });
  });

  describe('칩 설정(⋯): 가는 난이도와 숙련도', () => {
    const K = '카제로스 종막 (카제로스)';
    const settingsOf = (name: string, raid: string) => screen.queryByRole('group', { name: `${name} ${raid} 설정` });
    /** 설정 칸의 선택 상자. 닫혀 있으면 ⋯를 눌러 연다. */
    const field = (name: string, raid: string, what: '숙련도' | '가는 난이도') => {
      if (!settingsOf(name, raid)) openSettings(name, raid);
      return screen.getByRole('combobox', { name: `${name} ${raid} ${what}` }) as HTMLSelectElement;
    };
    const prof = (name: string, raid: string) => field(name, raid, '숙련도');
    const diff = (name: string, raid: string) => field(name, raid, '가는 난이도');
    const profPuts = () => calls.filter((c) => c.url.endsWith('/proficiency')).map((c) => ({ url: c.url, method: c.method, body: c.body }));
    const diffPuts = () => calls.filter((c) => c.url.endsWith('/target-difficulty')).map((c) => ({ url: c.url, method: c.method, body: c.body }));
    const friendGets = () => calls.filter((c) => c.url === '/api/friends' && c.method === 'GET');
    beforeEach(() => { FRIENDS[0].proficiency = { '가나|세르카': '숙련' }; });
    afterEach(() => { delete FRIENDS[0].proficiency; delete FRIENDS[0].targetDifficulty; });

    it('⋯ 버튼은 aria-expanded로 설정 칸을 열고 닫고, Escape로 닫으면 ⋯ 버튼으로 돌아간다', async () => {
      await renderLoaded();
      const btn = settingsBtn('가나', K);
      expect(btn).toHaveAttribute('aria-expanded', 'false');
      expect(settingsOf('가나', K)).toBeNull();
      fireEvent.click(btn);
      expect(btn).toHaveAttribute('aria-expanded', 'true');
      const panel = settingsOf('가나', K)!;
      expect(btn).toHaveAttribute('aria-controls', panel.id);
      const select = within(panel).getByRole('combobox', { name: `가나 ${K} 숙련도` });
      select.focus();
      fireEvent.keyDown(select, { key: 'Escape' });
      expect(settingsOf('가나', K)).toBeNull();
      expect(btn).toHaveAttribute('aria-expanded', 'false');
      expect(btn).toHaveFocus();
      fireEvent.click(btn);
      fireEvent.click(within(settingsOf('가나', K)!).getByRole('button', { name: '닫기' }));
      expect(settingsOf('가나', K)).toBeNull();
    });

    it('숙련도: 정하지 않은 칸은 "반숙 (기본)"으로 흐리게, 정한 칸은 또렷하게 + "직접 정함", 칩의 ⋯에도 표시', async () => {
      await renderLoaded();
      const set = prof('가나', '세르카');
      expect(set.value).toBe('숙련');
      expect(set).not.toHaveClass('select--prof-default');
      expect(set).toHaveClass('select--prof-expert');
      expect(within(settingsOf('가나', '세르카')!).getAllByText('직접 정함')).toHaveLength(1); // 숙련도만 (가는 난이도는 자동)
      expect(settingsBtn('가나', '세르카')).toHaveAccessibleName('가나 세르카 설정 (직접 정한 값 있음)');
      const unset = prof('가나', K);
      expect(unset.value).toBe('');
      expect(unset).toHaveClass('select--prof-default');
      expect(within(unset).getAllByRole('option').map((o) => o.textContent)).toEqual(['◐ 반숙 (기본)', '● 숙련', '◐ 반숙', '○ 클경']);
      expect((within(unset).getByRole('option', { selected: true }) as HTMLOptionElement).textContent).toBe('◐ 반숙 (기본)');
      expect(within(settingsOf('가나', K)!).queryByText('직접 정함')).toBeNull();
      expect(settingsBtn('가나', K)).toHaveAccessibleName(`가나 ${K} 설정`);
      // 설정 칸은 그 칩 바로 아래(같은 칸)에 펼쳐진다
      expect(set.closest('li')).toContainElement(chip('가나', '세르카'));
    });

    it('숙련도를 바꾸면 PUT /api/friends/<id>/proficiency (레이드 이름 기준), 기본으로 돌리면 level null', async () => {
      await renderLoaded();
      fireEvent.change(prof('가나', K), { target: { value: '클경' } });
      await waitFor(() => expect(profPuts()).toHaveLength(1));
      expect(profPuts()[0]).toEqual({ url: '/api/friends/f1/proficiency', method: 'PUT', body: { characterName: '가나', raidName: K, level: '클경' } });
      expect(prof('가나', K).value).toBe('클경');
      fireEvent.change(prof('가나', '세르카'), { target: { value: '' } });
      await waitFor(() => expect(profPuts()).toHaveLength(2));
      expect(profPuts()[1].body).toEqual({ characterName: '가나', raidName: '세르카', level: null });
      await waitFor(() => expect(prof('가나', '세르카')).toHaveClass('select--prof-default'));
    });

    it('저장 뒤 공대 후보를 다시 불러온다', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByRole('checkbox', { name: '세르카 하드' }));
      await waitFor(() => expect(planCalls().length).toBeGreaterThan(0));
      const before = planCalls().length;
      fireEvent.change(prof('다라', '세르카'), { target: { value: '숙련' } });
      await waitFor(() => expect(profPuts()).toHaveLength(1));
      await waitFor(() => expect(planCalls().length).toBeGreaterThan(before));
    });

    it('가는 난이도: 자동(현재 자동값) + 레벨이 되는 난이도 + 안 감, 바꾸면 PUT하고 칩 글자가 바뀐다 (자동은 null)', async () => {
      await renderLoaded();
      const select = diff('가나', '세르카');
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['자동 (하드)', '노말', '하드', '안 감']); // 1730: 나이트메어(1740)는 없다
      expect(select.value).toBe('');
      expect(select).toHaveClass('select--default');

      fireEvent.change(select, { target: { value: '노말' } });
      expect(chip('가나', '세르카')).toHaveAccessibleName('가나 세르카 노말: 미완'); // 먼저 화면에 반영
      await waitFor(() => expect(diffPuts()).toHaveLength(1));
      expect(diffPuts()[0]).toEqual({ url: '/api/friends/f1/target-difficulty', method: 'PUT', body: { characterName: '가나', raidName: '세르카', difficulty: '노말' } });
      expect(diff('가나', '세르카')).not.toHaveClass('select--default');
      expect(within(settingsOf('가나', '세르카')!).getAllByText('직접 정함')).toHaveLength(2);

      fireEvent.change(diff('가나', '세르카'), { target: { value: '안 감' } });
      await waitFor(() => expect(diffPuts()).toHaveLength(2));
      expect(diffPuts()[1].body).toEqual({ characterName: '가나', raidName: '세르카', difficulty: '안 감' });
      const skip = chip('가나', '세르카');
      expect(skip).toHaveAccessibleName('가나 세르카: 안 감');
      expect(skip).toHaveTextContent('세르카 · 안 감');
      expect(skip).toBeDisabled(); // 안 가는 레이드는 클리어 표시를 하지 않는다

      fireEvent.change(diff('가나', '세르카'), { target: { value: '' } });
      await waitFor(() => expect(diffPuts()).toHaveLength(3));
      expect(diffPuts()[2].body).toEqual({ characterName: '가나', raidName: '세르카', difficulty: null });
      expect(chip('가나', '세르카')).toHaveAccessibleName('가나 세르카 하드: 미완');
    });

    it('직접 정한 가는 난이도로 칩을 누르면 그 난이도로 기록한다', async () => {
      FRIENDS[0].targetDifficulty = { '가나|세르카': '노말' };
      await renderLoaded();
      expect(chip('가나', '세르카')).toHaveAccessibleName('가나 세르카 노말: 미완');
      expect(diff('가나', '세르카').value).toBe('노말');
      fireEvent.click(chip('가나', '세르카'));
      await waitFor(() => expect(calls.some((c) => c.url === '/api/clears' && c.method === 'PUT')).toBe(true));
      expect(calls.find((c) => c.url === '/api/clears' && c.method === 'PUT')!.body).toEqual({
        characterName: '가나',
        records: [{ raidName: '세르카', difficulty: '노말' }],
      });
    });

    it('가는 난이도 저장이 실패하면 서버 값(자동)으로 되돌리고 안내한다', async () => {
      diffResponder = async () => json({ error: '저장 실패' }, 500);
      await renderLoaded();
      fireEvent.change(diff('가나', '세르카'), { target: { value: '노말' } });
      expect(await screen.findByText('가나의 세르카 가는 난이도를 저장하지 못했어요: 저장 실패')).toBeInTheDocument();
      await waitFor(() => expect(chip('가나', '세르카')).toHaveAccessibleName('가나 세르카 하드: 미완'));
      expect(diff('가나', '세르카').value).toBe('');
    });

    describe('카드 단위 숙련도 한 번에 바꾸기', () => {
      const bulk = (name: string) => screen.getByRole('combobox', { name: `${name} 모든 레이드 숙련도 한 번에 바꾸기` }) as HTMLSelectElement;

      it('고른 숙련도를 그 캐릭터의 모든 레이드 칩에 PUT 하나씩 보내고, "—"는 아무 것도 안 한다', async () => {
        await renderLoaded();
        expect(within(bulk('가나')).getAllByRole('option').map((o) => o.textContent)).toEqual(['—', '● 숙련', '◐ 반숙', '○ 클경']);
        fireEvent.change(bulk('가나'), { target: { value: '' } });
        await new Promise((r) => setTimeout(r, 20));
        expect(profPuts()).toHaveLength(0);
        fireEvent.change(bulk('가나'), { target: { value: '클경' } });
        await waitFor(() => expect(profPuts()).toHaveLength(RAIDS_1730.length));
        expect(profPuts().map((p) => p.body)).toEqual(RAIDS_1730.map((raidName) => ({ characterName: '가나', raidName, level: '클경' })));
        expect(profPuts().every((p) => p.url === '/api/friends/f1/proficiency' && p.method === 'PUT')).toBe(true);
        expect(bulk('가나').value).toBe(''); // 다시 "—"로
        expect(prof('가나', '세르카').value).toBe('클경');
        expect(prof('가나', K).value).toBe('클경');
      });

      it('일부가 실패하면 실패한 레이드를 모아서 알리고 그 칸만 되돌린다', async () => {
        profResponder = async (body) => (body.raidName === '세르카' ? json({ error: '저장 실패' }, 500) : json(FRIENDS[0]));
        await renderLoaded();
        fireEvent.change(bulk('가나'), { target: { value: '클경' } });
        expect(await screen.findByText('가나의 숙련도를 1개 레이드(세르카)에서 저장하지 못했어요: 저장 실패')).toBeInTheDocument();
        await waitFor(() => expect(prof('가나', '세르카').value).toBe('숙련')); // 서버 값으로
        expect(prof('가나', K).value).toBe('클경');
      });
    });

    describe('저장 순서', () => {
      type Gate = { body: { characterName: string; raidName: string; level: string | null }; ok: () => void; fail: () => void };
      let gates: Gate[];
      let server: Record<string, string | null>;
      beforeEach(() => {
        gates = [];
        server = {};
        profResponder = (body) => new Promise<Response>((resolve) => {
          gates.push({
            body,
            ok: () => { server[`${body.characterName}|${body.raidName}`] = body.level; resolve(json(FRIENDS[0])); },
            fail: () => resolve(json({ error: '저장 실패' }, 500)),
          });
        });
      });

      it('같은 칸을 빠르게 여러 번 바꾸면 하나씩 순서대로 보내고, 마지막 값으로 끝난다', async () => {
        await renderLoaded();
        fireEvent.change(prof('가나', K), { target: { value: '클경' } });
        await waitFor(() => expect(gates).toHaveLength(1));
        fireEvent.change(prof('가나', K), { target: { value: '숙련' } });
        fireEvent.change(prof('가나', K), { target: { value: '반숙' } });
        await new Promise((r) => setTimeout(r, 20));
        expect(gates).toHaveLength(1); // 앞 요청이 끝나기 전에는 보내지 않는다
        expect(prof('가나', K).value).toBe('반숙');
        gates[0].ok();
        await waitFor(() => expect(gates).toHaveLength(2));
        expect(gates[1].body.level).toBe('반숙'); // 대기 중이던 변경은 최신 값 하나로
        gates[1].ok();
        await waitFor(() => expect(server[`가나|${K}`]).toBe('반숙'));
        expect(gates.map((g) => g.body.level)).toEqual(['클경', '반숙']);
        expect(prof('가나', K).value).toBe('반숙');
      });

      it('다른 칸은 서로 기다리지 않는다', async () => {
        await renderLoaded();
        fireEvent.change(prof('가나', K), { target: { value: '클경' } });
        fireEvent.change(prof('가나', '지평의 성당'), { target: { value: '숙련' } });
        await waitFor(() => expect(gates).toHaveLength(2));
      });

      it('첫 저장이 실패해도 대기 중인 새 값은 되돌리지 않는다', async () => {
        await renderLoaded();
        fireEvent.change(prof('가나', K), { target: { value: '클경' } });
        await waitFor(() => expect(gates).toHaveLength(1));
        fireEvent.change(prof('가나', K), { target: { value: '숙련' } });
        gates[0].fail();
        await waitFor(() => expect(gates).toHaveLength(2));
        gates[1].ok();
        await waitFor(() => expect(server[`가나|${K}`]).toBe('숙련'));
        await new Promise((r) => setTimeout(r, 20));
        expect(prof('가나', K).value).toBe('숙련');
        expect(screen.queryByText(/숙련도를 저장하지 못했어요/)).not.toBeInTheDocument();
      });

      it('실패하면 서버 값으로 되돌리고 안내한다', async () => {
        await renderLoaded();
        expect(friendGets()).toHaveLength(1);
        fireEvent.change(prof('가나', '세르카'), { target: { value: '클경' } });
        await waitFor(() => expect(gates).toHaveLength(1));
        expect(prof('가나', '세르카').value).toBe('클경'); // 먼저 화면에 반영
        gates[0].fail();
        expect(await screen.findByText('가나의 세르카 숙련도를 저장하지 못했어요: 저장 실패')).toBeInTheDocument();
        await waitFor(() => expect(friendGets()).toHaveLength(2));
        await waitFor(() => expect(prof('가나', '세르카').value).toBe('숙련'));
      });

      it('숙련도 저장 중에 같은 친구의 전투력 저장이 끝나도 화면의 숙련도 값이 되돌아가지 않는다', async () => {
        await renderLoaded();
        fireEvent.change(prof('가나', K), { target: { value: '클경' } });
        await waitFor(() => expect(gates).toHaveLength(1));
        // 전투력 저장 응답은 서버 사본(숙련도 저장 전)이라 종막 칸 값이 없다
        const input = screen.getByRole('spinbutton', { name: '가나서폿 전투력' });
        fireEvent.change(input, { target: { value: '1800' } });
        fireEvent.submit(input.closest('form')!);
        expect(await screen.findByText('1,800')).toBeInTheDocument();
        expect(prof('가나', K).value).toBe('클경');
        gates[0].ok();
        await waitFor(() => expect(server[`가나|${K}`]).toBe('클경'));
        await new Promise((r) => setTimeout(r, 20));
        expect(prof('가나', K).value).toBe('클경');
        expect(prof('가나', '세르카').value).toBe('숙련'); // 다른 칸은 서버 사본 그대로
      });

      it('실패 뒤 되돌리기 재조회가 끝나기 전에 새 변경이 저장되면, 늦게 온 옛 서버 값으로 되돌리지 않는다', async () => {
        let releaseRefetch!: () => void;
        friendsResponder = () => new Promise<Response>((resolve) => { releaseRefetch = () => resolve(json(FRIENDS)); }); // 옛 값(세르카 = 숙련)
        await renderLoaded();
        fireEvent.change(prof('가나', '세르카'), { target: { value: '클경' } });
        await waitFor(() => expect(gates).toHaveLength(1));
        gates[0].fail();
        await waitFor(() => expect(friendGets()).toHaveLength(2)); // 되돌리기용 재조회가 진행 중
        fireEvent.change(prof('가나', '세르카'), { target: { value: '반숙' } });
        await waitFor(() => expect(gates).toHaveLength(2));
        gates[1].ok();
        await waitFor(() => expect(server['가나|세르카']).toBe('반숙'));
        releaseRefetch();
        await new Promise((r) => setTimeout(r, 30));
        expect(prof('가나', '세르카').value).toBe('반숙');
      });
    });
  });

  it('여러 레이드를 고르면 후보 카드 제목 id가 겹치지 않는다', async () => {
    planResult = {
      candidates: [friendsOnly, multiRun],
      excluded: [],
    };
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '세르카 하드' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '카제로스 종막 (카제로스) 하드' }));
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
    expect(chip('다라', '세르카')).toBeInTheDocument();
    expect(queryChip('가나', '세르카')).not.toBeInTheDocument();
    expect(within(filterGroup()).getByRole('button', { name: /^민수/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(filterGroup()).getByRole('button', { name: /^전체/ }));
    expect(chip('가나', '세르카')).toBeInTheDocument();
    expect(chip('다라', '세르카')).toBeInTheDocument();
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
    expect(chip('다라', '세르카')).toBeInTheDocument();
  });

  it('저장된 필터를 적용하고, 선택 시 저장한다', async () => {
    localStorage.setItem(FILTER_KEY, 'f2');
    render(<Home />);
    await screen.findByRole('button', { name: chipName('다라', '세르카') });
    expect(queryChip('가나', '세르카')).not.toBeInTheDocument();
    fireEvent.click(within(filterGroup()).getByRole('button', { name: /^영준/ }));
    expect(localStorage.getItem(FILTER_KEY)).toBe('f1');
  });

  it('저장된 값이 없는 친구를 가리키면 무시한다', async () => {
    localStorage.setItem(FILTER_KEY, 'ghost');
    await renderLoaded();
    expect(chip('다라', '세르카')).toBeInTheDocument();
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
      expect(queryChip('가나', '세르카')).not.toBeInTheDocument();
    } finally {
      Storage.prototype.getItem = orig;
      Storage.prototype.setItem = origSet;
    }
  });

  it('그룹 안에서 전투력 높은 순으로 보이고 전투력 없는 캐릭터는 뒤에 온다', async () => {
    FRIENDS[0].characters = [ch('낮음', 'dealer', 100), ch('없음', 'dealer', null, 1800), ch('높음', 'dealer', 3000)];
    try {
      render(<Home />);
      await screen.findByRole('button', { name: chipName('높음', '세르카') });
      const names = screen.getAllByRole('button', { name: / 세르카 \S+: / })
        .map((b) => b.getAttribute('aria-label')!.split(' ')[0]);
      expect(names).toEqual(['높음', '낮음', '없음', '다라']);
    } finally {
      FRIENDS[0].characters = [ch('가나'), ch('가나서폿', 'support', null)];
    }
  });
});

describe('레이드 고르기: 후보가 있는 난이도만', () => {
  const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
  const person = (name: string) => within(screen.getByRole('group', { name: '참석하는 친구' })).getByRole('checkbox', { name });

  it('난이도마다 갈 수 있는 캐릭터 수를 보여 주고, 없는 난이도는 "갈 수 있는 캐릭터 없음"으로 비활성', async () => {
    await renderLoaded();
    // 기본 픽스처는 모두 1730 → 세르카는 자동으로 하드
    expect(box('세르카 하드')).toBeEnabled();
    expect(box('세르카 하드')).toHaveAccessibleDescription('갈 수 있는 캐릭터 3개');
    expect(box('세르카 하드').closest('label')).toHaveTextContent('하드 · 3');
    for (const name of ['세르카 노말', '세르카 나이트메어', '지평의 성당 1단계', '벨가르딘 노말']) {
      expect(box(name)).toBeDisabled();
      expect(box(name)).toHaveAccessibleDescription('갈 수 있는 캐릭터 없음');
    }
    expect(box('지평의 성당 2단계')).toHaveAccessibleDescription('갈 수 있는 캐릭터 3개');
  });

  it('참석자, 클리어, 가는 난이도가 바뀌면 수가 바로 바뀐다', async () => {
    FRIENDS[1].targetDifficulty = { '다라|세르카': '노말' };
    try {
      await renderLoaded();
      expect(box('세르카 하드')).toHaveAccessibleDescription('갈 수 있는 캐릭터 2개');
      expect(box('세르카 노말')).toHaveAccessibleDescription('갈 수 있는 캐릭터 1개');
      fireEvent.click(person('민수'));
      expect(box('세르카 노말')).toBeDisabled();
      fireEvent.click(chip('가나', '세르카'));
      expect(box('세르카 하드')).toHaveAccessibleDescription('갈 수 있는 캐릭터 1개');
    } finally {
      delete FRIENDS[1].targetDifficulty;
    }
  });

  it('고른 난이도의 후보가 모두 사라져도 선택은 그대로 두고 안내를 보여 준다', async () => {
    await renderLoaded();
    fireEvent.click(box('세르카 하드'));
    expect(box('세르카 하드')).toBeChecked();
    for (const c of ['가나', '가나서폿', '다라']) fireEvent.click(chip(c, '세르카'));
    expect(box('세르카 하드')).toBeChecked();
    expect(box('세르카 하드')).toBeEnabled(); // 다시 끌 수 있게
    expect(box('세르카 하드')).toHaveAccessibleDescription('갈 수 있는 캐릭터 없음');
    expect(box('세르카 하드').closest('label')).toHaveTextContent('갈 수 있는 캐릭터 없음');
    fireEvent.click(box('세르카 하드'));
    expect(box('세르카 하드')).not.toBeChecked();
    expect(box('세르카 하드')).toBeDisabled();
  });
});
