# 로스트아크 레이드 공대 편성 도구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 친구 약 5명의 원정대를 로스트아크 Open API로 불러와, 레이드마다 입장 레벨·서포터 규칙·클리어 상태를 지키는 공대 후보를 계산해 웹과 디스코드 봇에서 보여 준다.

**Architecture:** 순수 함수인 편성 로직(`src/core`)을 하나 만들고, 웹(Next.js 페이지 + `/api`)과 디스코드(Interactions 웹훅 `/api/discord`)가 같은 로직과 같은 저장소(`Store` 인터페이스)를 쓴다. 저장소는 개발 중에는 메모리, 배포에서는 Upstash Redis다. 편성 로직은 외부 호출이 없어 단위 테스트로 먼저 검증한다.

**Tech Stack:** TypeScript, Next.js 15 (App Router), Vitest, `@upstash/redis`, `discord-interactions`, Vercel (+Cron). (스택은 빌더 재량이라는 스펙에 따라 설계자가 고른 값이다.)

**Spec:** `docs/superpowers/specs/2026-10-16-raid-party-planner-design.md`

## Global Constraints

- 편성은 레이드마다 따로 계산한다. 4인 레이드는 서포터 1자리, 8인 레이드는 서포터 2자리.
- 입장 레벨 미달 캐릭터는 그 레이드 후보에서 제외한다 (엄격한 조건).
- 같은 공대에 한 사람의 캐릭터는 최대 1개.
- 클리어 단위는 "캐릭터 × 레이드 이름". 같은 레이드는 한 주에 한 난이도만 갈 수 있으므로, 어느 난이도든 클리어했으면 같은 레이드의 모든 난이도에서 제외한다. 지평의 성당 1·2·3단계는 난이도다.
- 권장 전투력은 부드러운 기준이다. 공대 평균(서포터 제외 딜러만)과 비교해 단계(`comfortable`/`tight`/`risky`/`unknown`)로 보여 줄 뿐 후보를 막지 않는다.
- 외부인은 평균 계산에서 제외한다.
- 후보는 분배 방식별로 여러 개 보여 준다 (예: 5명이 4인 레이드면 3+2, 4+1).
- 주간 초기화는 수요일 06:00 KST.
- 로스트아크 API: 헤더 `authorization: bearer <JWT>`, 분당 100회. 토큰은 서버 환경변수에만 둔다.
- 디스코드: Interactions Endpoint URL 방식, 서명 검증 필수, 3초 안에 응답하거나 먼저 "처리 중"(type 5)으로 응답.
- 슬래시 명령어 `/명령어`는 본인에게만 보이는(ephemeral) 도움말을 보여 준다. 모든 명령어에 한글 설명을 붙인다.
- 모든 사용자 노출 문구는 한국어.

## Review Focus

1. 친구의 모든 캐릭터가 레벨 미달이거나 클리어 상태 → 그 친구를 참석자에서 빼고 "가능한 캐릭터 없음" 사유를 반환한다 (Task 4).
2. 서포터만 있는 공대 등 딜러 평균을 낼 수 없는 경우 → 에러 없이 `tier: 'unknown'` (Task 4).
3. 전투력이 `null`(API 미제공)인 캐릭터 → 평균에서 제외하고 `unknown`으로 표시, 수동 입력으로 해결 (Task 4, 6).
4. 같은 레이드의 다른 난이도를 이미 클리어 → 제외 (Task 3).
5. 존재하지 않는 대표 캐릭터 이름 / API 429 / 잘못된 디스코드 서명 → 친절한 오류 메시지, 서명 오류는 401 (Task 5, 9).

---

## 파일 구조

```
package.json, tsconfig.json, vitest.config.ts, next.config.ts, vercel.json
src/core/types.ts          공용 타입
src/core/raids.ts          레이드 설정 14행 (수정 가능한 설정)
src/core/week.ts           weekKey (수요일 06:00 KST 기준)
src/core/eligibility.ts    eligibleCharacters
src/core/planner.ts        planRaid, tierFor
src/lostark/client.ts      API 클라이언트 + 응답 정규화
src/store/store.ts         Store 인터페이스, 메모리 구현, Upstash 구현, getStore()
src/lib/auth.ts            공유 비밀번호 검사
src/app/api/...            웹용 REST 라우트
src/app/page.tsx           웹 화면
src/discord/commands.ts    명령어 정의(한글 설명) + 등록 스크립트용 데이터
src/discord/handler.ts     명령어/컴포넌트 처리
src/app/api/discord/route.ts  서명 검증 + 라우팅
src/app/api/cron/weekly/route.ts
scripts/probe-lostark.ts, scripts/register-commands.ts
README.md                  처음 쓰는 사람용 설정 안내
tests/                     각 모듈의 테스트
```

---

### Task 1: 프로젝트 골격, 타입, 레이드 설정

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/core/types.ts`, `src/core/raids.ts`
- Test: `tests/core/raids.test.ts`

**Interfaces:**
- Produces (`src/core/types.ts`):
  ```ts
  export type Role = 'support' | 'dealer';
  export interface Character { name: string; className: string; role: Role; itemLevel: number; combatPower: number | null; }
  export interface Friend { id: string; displayName: string; discordUserId?: string; representativeName: string; characters: Character[]; }
  export interface RaidConfig { id: string; name: string; difficulty: string; size: 4 | 8; minLevel: number; recommendedCP: { min: number; max: number | null }; }
  export interface ClearRecord { characterName: string; raidName: string; difficulty: string; }
  export type Tier = 'comfortable' | 'tight' | 'risky' | 'unknown';
  export type Slot = { kind: 'friend'; friendId: string; character: Character } | { kind: 'external'; role: Role };
  export interface Party { slots: Slot[]; dealerAvgCP: number | null; tier: Tier; }
  export interface Candidate { label: string; parties: Party[]; externalCount: number; imbalance: number; }
  export interface PlanResult { candidates: Candidate[]; excluded: { friendId: string; reason: string }[]; }
  ```
- Produces (`src/core/raids.ts`): `export const RAIDS: RaidConfig[]` (스펙 표 14행 그대로, `id` 형식 `<이름슬러그>-<난이도슬러그>` 예: `serka-hard`), `export function getRaid(id: string): RaidConfig | undefined`, `export const SUPPORT_CLASSES: string[]`.

- [ ] **Step 1: `git init`하고 Next.js 15 + TypeScript + Vitest 골격을 만든다.** `npm run test`가 `vitest run`, `npm run dev`가 Next 개발 서버를 실행하게 한다. `.gitignore`에 `.env*.local`, `.superpowers/`, `node_modules`를 넣는다.
- [ ] **Step 2: 실패하는 테스트를 쓴다** (`tests/core/raids.test.ts`):
  ```ts
  it('스펙의 14개 레이드가 있다', () => expect(RAIDS).toHaveLength(14));
  it('세르카 하드는 4인, 1730, 권장 3600~4000', () => {
    expect(getRaid('serka-hard')).toMatchObject({ size: 4, minLevel: 1730, recommendedCP: { min: 3600, max: 4000 } });
  });
  it('벨가르딘 나이트메어는 8인, 1780, 최대 없음', () => {
    expect(getRaid('belgardin-nightmare')).toMatchObject({ size: 8, minLevel: 1780, recommendedCP: { min: 7000, max: null } });
  });
  it('4인은 세르카·지평의 성당뿐, 나머지는 8인', () => {
    for (const r of RAIDS) expect(r.size).toBe(['세르카', '지평의 성당'].includes(r.name) ? 4 : 8);
  });
  ```
- [ ] **Step 3: 실행해서 실패를 확인한다.** Run: `npx vitest run tests/core/raids.test.ts` → Expected: FAIL (모듈 없음).
- [ ] **Step 4: `types.ts`와 `raids.ts`를 구현한다.** 값은 스펙의 "레이드 설정" 표를 그대로 옮긴다. `SUPPORT_CLASSES`는 `['바드', '홀리나이트', '도화가']`로 두고 Task 5의 probe 결과로 확정한다는 주석을 단다.
- [ ] **Step 5: 테스트가 통과하는지 확인하고 커밋한다.** `git commit -m "feat: 프로젝트 골격과 레이드 설정"`

---

### Task 2: 주간 키 (수요일 06:00 KST)

**Files:**
- Create: `src/core/week.ts`
- Test: `tests/core/week.test.ts`

**Interfaces:**
- Produces: `export function weekKey(now: Date): string` — 가장 최근 수요일 06:00 KST의 날짜를 `YYYY-MM-DD`로 반환.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 2026-10-14는 수요일이다.
  ```ts
  it('수요일 05:59 KST는 전주 키', () => expect(weekKey(new Date('2026-10-14T05:59:00+09:00'))).toBe('2026-10-07'));
  it('수요일 06:00 KST부터 새 키', () => expect(weekKey(new Date('2026-10-14T06:00:00+09:00'))).toBe('2026-10-14'));
  it('금요일은 같은 주 키', () => expect(weekKey(new Date('2026-10-16T12:00:00+09:00'))).toBe('2026-10-14'));
  it('UTC 입력도 KST 기준으로 계산', () => expect(weekKey(new Date('2026-10-13T21:00:00Z'))).toBe('2026-10-14'));
  ```
- [ ] **Step 2: 실패 확인 후 구현한다.** KST(UTC+9) 시각으로 옮겨 6시간을 빼고 그날 기준으로 직전(또는 당일) 수요일을 구한다.
- [ ] **Step 3: 통과 확인 후 커밋한다.** Run: `npx vitest run tests/core/week.test.ts`

> **설계 결정:** 클리어 기록을 이 키로 저장하므로 주가 바뀌면 자동으로 "초기화"된다. Task 10의 크론은 지난주 기록 삭제와 로스터 갱신만 한다 (스펙 목표 4를 충족).

---

### Task 3: 후보 자격 (입장 레벨, 클리어, 난이도 배타)

**Files:**
- Create: `src/core/eligibility.ts`
- Test: `tests/core/eligibility.test.ts`

**Interfaces:**
- Consumes: `Friend`, `Character`, `RaidConfig`, `ClearRecord` (Task 1).
- Produces: `export function eligibleCharacters(friend: Friend, raid: RaidConfig, clears: ClearRecord[]): Character[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 픽스처: 친구 하나, 캐릭터 `A`(1740 딜러), `B`(1700 딜러), `C`(1735 서포터).
  ```ts
  it('입장 레벨 미달은 제외 (세르카 하드 1730: B 제외)', ...toEqual(['A','C']));
  it('같은 난이도 클리어한 캐릭터는 제외', ...clears=[{A, 세르카, 하드}] → ['C']);
  it('같은 레이드의 다른 난이도 클리어도 제외', ...clears=[{A, 세르카, 노말}], raid=serka-hard → ['C']);
  it('다른 레이드 클리어는 영향 없음', ...clears=[{A, 벨가르딘, 하드}] → ['A','C']);
  it('캐릭터 단위 판단: A만 클리어해도 같은 친구의 C는 남는다');
  ```
- [ ] **Step 2: 실패 확인 후 `eligibleCharacters`를 구현한다.** 순서는 입력 순서를 유지한다.
- [ ] **Step 3: 통과 확인 후 커밋한다.**

---

### Task 4: 편성 계산 (핵심)

**Files:**
- Create: `src/core/planner.ts`
- Test: `tests/core/planner.test.ts`

**Interfaces:**
- Consumes: `eligibleCharacters` (Task 3), 타입 (Task 1).
- Produces:
  ```ts
  export function tierFor(avg: number | null, raid: RaidConfig): Tier;
  export function planRaid(input: { raid: RaidConfig; friends: Friend[]; clears: ClearRecord[]; attendeeIds: string[]; limit?: number }): PlanResult;
  ```
  `limit` 기본 5.

**규칙 (알고리즘 결정):**
1. 참석자 중 자격 있는 캐릭터가 없는 친구는 `excluded`에 `"가능한 캐릭터 없음"` 사유로 넣고 계산에서 뺀다.
2. 남은 친구 수 `n`, 공대 수 `P = ceil(n / raid.size)`. 친구를 `P`개 그룹으로 나누는 모든 분배(각 그룹 크기 ≤ `raid.size`, 크기 순서 무시)를 열거한다. 라벨은 `"3+2"`처럼 큰 수부터.
3. 각 분배에서 친구마다 자격 있는 캐릭터 하나를 고르는 모든 조합을 탐색한다 (탐색량이 크면 전투력 상위 캐릭터로 가지치기).
4. 공대의 서포터 자리 수는 `raid.size / 4`. 공대 안 친구 서포터가 자리보다 많으면 그 조합은 무효. 모자라면 부족한 만큼 `external support`, 남는 자리는 `external dealer`로 채운다. 공대 인원은 항상 `raid.size`.
5. `dealerAvgCP` = 공대 안 친구 **딜러** 중 `combatPower`가 null이 아닌 값의 평균. 대상이 없으면 `null`.
6. `tierFor(avg)`: avg가 null → `unknown`; `avg >= recommendedCP.min` → `comfortable`; `avg >= recommendedCP.min * 0.9` → `tight`; 그 외 `risky`. (0.9는 상수 `TIGHT_RATIO`로 노출해 조정 가능하게 한다.)
7. `imbalance` = 공대별 `dealerAvgCP`(null 제외)의 최댓값 − 최솟값 (하나뿐이면 0).
8. 정렬: `externalCount` 오름차순 → 공대 중 가장 나쁜 단계 오름차순(나쁜 순서: `risky` > `tight` > `unknown` > `comfortable`) → `imbalance` 오름차순. 분배 라벨과 선택 캐릭터가 같은 후보는 중복 제거 후 상위 `limit`개.

- [ ] **Step 1: `tierFor` 테스트를 쓴다.**
  ```ts
  const raid = getRaid('serka-hard')!; // 권장 3600~4000
  it('null → unknown', () => expect(tierFor(null, raid)).toBe('unknown'));
  it('3600 이상 → comfortable', () => expect(tierFor(3600, raid)).toBe('comfortable'));
  it('3240~3599 → tight', () => expect(tierFor(3240, raid)).toBe('tight'));
  it('3239 → risky', () => expect(tierFor(3239, raid)).toBe('risky'));
  ```
- [ ] **Step 2: `planRaid` 테스트를 쓴다.** 5명 픽스처(`makeFriends` 헬퍼, 각 2~3캐릭터, 서포터 2명).
  ```ts
  it('5명이 4인 레이드: 3+2와 4+1 분배가 모두 나온다', ...labels toContain('3+2') and ('4+1'));
  it('모든 공대 크기는 raid.size', ...parties.every(p => p.slots.length === 4));
  it('한 공대에 같은 친구의 캐릭터는 하나뿐', ...);
  it('서포터 자리 수를 넘는 서포터는 배치되지 않는다 (4인: 공대당 서포터 ≤1)');
  it('서포터 부족 시 external support로 채우고 externalCount에 반영');
  it('8인 레이드는 서포터 2자리');
  it('입장 레벨 미달/클리어한 캐릭터는 어떤 후보에도 없다');
  it('클리어로 가능한 캐릭터가 없는 친구는 excluded에 사유와 함께 들어간다 [Review Focus 1]');
  it('서포터만 있는 공대는 dealerAvgCP null, tier unknown, 예외 없음 [Review Focus 2]');
  it('combatPower null 딜러는 평균에서 빠지고 평균이 NaN이 아니다 [Review Focus 3]');
  it('참석자 0명이면 candidates [] 이고 예외 없음');
  it('imbalance가 작은 후보가 앞선다 (externalCount 동률일 때)');
  it('limit 기본값 5');
  ```
- [ ] **Step 3: 실패 확인 후 `tierFor`, `planRaid`를 위 규칙대로 구현한다.** 분배 열거와 조합 탐색은 작은 보조 함수(`partitions`, `product`)로 나눈다.
- [ ] **Step 4: 전체 코어 테스트가 통과하는지 확인하고 커밋한다.** Run: `npx vitest run tests/core`

---

### Task 5: 로스트아크 API 클라이언트와 probe

**Files:**
- Create: `src/lostark/client.ts`, `scripts/probe-lostark.ts`
- Test: `tests/lostark/client.test.ts`, `tests/lostark/fixtures/*.json`

**Interfaces:**
- Consumes: `Character`, `SUPPORT_CLASSES` (Task 1).
- Produces:
  ```ts
  export class LostArkError extends Error { constructor(public code: 'not_found' | 'rate_limited' | 'unauthorized' | 'unknown', message: string); }
  export async function fetchRoster(representativeName: string, opts?: { token?: string; fetchImpl?: typeof fetch }): Promise<Character[]>;
  export function parseItemLevel(s: string): number;           // "1,620.50" → 1620.5
  export function detectRole(className: string, engravings: string[]): Role;
  ```

- [ ] **Step 1 (USER ACTION): `.env.local`에 `LOSTARK_JWT=<토큰>`을 넣게 안내한다.** 토큰은 로그나 저장소에 남기지 않는다.
- [ ] **Step 2: `scripts/probe-lostark.ts`를 만든다.** `GET /characters/{name}/siblings`와 `GET /armories/characters/{name}/profiles`를 실제로 호출해 (a) 원정대 목록에서 얻는 필드, (b) 전투력(`CombatPower`)이 어느 호출에 오는지, (c) 직업 각인으로 서포터를 구분할 수 있는지를 출력한다. 사용자가 실행한다: `npx tsx scripts/probe-lostark.ts <대표캐릭터>`. 결과를 `tests/lostark/fixtures/`에 (캐릭터명은 가명으로 바꿔) 저장한다.
- [ ] **Step 3: probe 결과로 스펙의 "확인하지 못한 것" 3가지를 확정한다.** 전투력이 API에 없으면 `combatPower: null`을 반환하고 Task 6의 수동 입력을 기본 경로로 삼는다고 이 계획 Task 6에 메모한다. 서포터 직업 목록을 `SUPPORT_CLASSES`에 반영한다.
- [ ] **Step 4: 실패하는 테스트를 쓴다 (픽스처 사용, 네트워크 없음).**
  ```ts
  it('parseItemLevel은 콤마를 제거한다', () => expect(parseItemLevel('1,620.50')).toBe(1620.5));
  it('원정대 응답을 Character[]로 정규화한다', ...);
  it('도화가는 support, 버서커는 dealer', ...);
  it('404/빈 응답이면 LostArkError(not_found) — "존재하지 않는 캐릭터" [Review Focus 5]', ...);
  it('429면 LostArkError(rate_limited)', ...);
  it('401/403이면 LostArkError(unauthorized)', ...);
  it('요청 헤더에 authorization: bearer <token>이 들어간다 ("bearer" 소문자 포함)', ...);
  ```
- [ ] **Step 5: 구현한다.** 캐릭터마다 프로필을 호출할 때는 분당 100회 제한을 넘지 않게 호출 사이에 간격을 두고, 429면 에러를 던진다.
- [ ] **Step 6: 통과 확인 후 커밋한다.**

---

### Task 6: 저장소

**Files:**
- Create: `src/store/store.ts`
- Test: `tests/store/store.test.ts`

**Interfaces:**
- Consumes: 타입 (Task 1), `weekKey` (Task 2).
- Produces:
  ```ts
  export interface Store {
    listFriends(): Promise<Friend[]>;
    getFriend(id: string): Promise<Friend | undefined>;
    saveFriend(f: Friend): Promise<void>;                       // 로스터 갱신 포함
    setManualCombatPower(friendId: string, characterName: string, cp: number | null): Promise<void>;
    getClears(week: string): Promise<ClearRecord[]>;
    setCharacterClears(week: string, characterName: string, records: Omit<ClearRecord, 'characterName'>[]): Promise<void>; // 해당 캐릭터의 그 주 기록을 통째로 교체
    deleteWeek(week: string): Promise<void>;
  }
  export function createMemoryStore(): Store;
  export function createUpstashStore(redis: Redis): Store;
  export function getStore(): Store;   // UPSTASH_REDIS_REST_URL 있으면 Upstash, 없으면 메모리 (프로세스 전역 하나)
  ```
  수동 전투력은 `listFriends`/`getFriend`가 돌려주는 `Character.combatPower`에 합쳐서(수동 값이 우선) 반환한다.

- [ ] **Step 1: 계약 테스트를 쓴다.** 메모리 구현에 대해 쓰고, 같은 테스트를 `describe.each`로 Upstash 구현(`@upstash/redis`를 mock한 맵)에도 돌린다.
  ```ts
  it('saveFriend 후 listFriends/getFriend로 읽힌다');
  it('setManualCombatPower가 API 값보다 우선하고, null로 지우면 원래 값으로 돌아간다');
  it('setCharacterClears는 해당 캐릭터의 기록을 교체하고 다른 캐릭터는 건드리지 않는다');
  it('주(week)가 다르면 클리어 기록이 분리된다');
  it('deleteWeek 후 getClears는 []');
  ```
- [ ] **Step 2: 실패 확인 후 구현하고 통과를 확인한 뒤 커밋한다.** Upstash 키는 `friend:<id>`, `friends`(id 집합), `clears:<week>`(해시: 캐릭터명 → JSON)로 한다.

---

### Task 7: 웹 API와 비밀번호

**Files:**
- Create: `src/lib/auth.ts`, `src/app/api/friends/route.ts`, `src/app/api/friends/[id]/route.ts`, `src/app/api/clears/route.ts`, `src/app/api/plan/route.ts`
- Test: `tests/api/*.test.ts`

**Interfaces:**
- Consumes: `Store`/`getStore` (Task 6), `planRaid` (Task 4), `fetchRoster` (Task 5), `weekKey` (Task 2).
- Produces:
  - `export function checkPassword(req: Request): boolean` — 헤더 `x-app-password`가 `process.env.APP_PASSWORD`와 같을 때만 true. 환경변수가 없으면 개발 편의상 true.
  - `GET /api/friends` → `Friend[]`; `POST /api/friends` body `{ displayName, representativeName }` → 로스터를 가져와 저장; `POST /api/friends/[id]/refresh`; `PUT /api/friends/[id]/combat-power` body `{ characterName, cp: number | null }`
  - `GET /api/clears` → 이번 주 `ClearRecord[]`; `PUT /api/clears` body `{ characterName, records: {raidName, difficulty}[] }` — 같은 `raidName`이 두 번 들어오면 400 `"한 레이드는 한 난이도만 선택할 수 있어요"`
  - `POST /api/plan` body `{ raidId, attendeeIds }` → `PlanResult`
  - 비밀번호가 틀리면 모든 라우트가 401.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 라우트 핸들러를 직접 호출하고 `createMemoryStore`를 주입한다.
  ```ts
  it('비밀번호가 틀리면 401');
  it('POST /api/plan이 raidId와 참석자로 후보를 돌려준다');
  it('알 수 없는 raidId는 400');
  it('PUT /api/clears에서 같은 레이드 두 난이도는 400');
  it('PUT /api/clears 후 POST /api/plan에서 그 캐릭터가 빠진다');
  it('POST /api/friends에서 fetchRoster가 not_found면 404와 "캐릭터를 찾을 수 없어요" [Review Focus 5]');
  ```
- [ ] **Step 2: 실패 확인 후 구현하고 통과를 확인한 뒤 커밋한다.** 라우트는 입력 검증과 위임만 하고 로직은 core/store에 둔다.

---

### Task 8: 웹 화면

**Files:**
- Create: `src/app/page.tsx`, `src/components/*` (필요한 만큼)
- Test: `tests/ui/page.test.tsx` (React Testing Library)

**Interfaces:**
- Consumes: Task 7의 REST API.

- [ ] **Step 1: 첫 접속 시 비밀번호 입력창**을 두고, 입력값을 `x-app-password` 헤더로 보낸다 (브라우저 `localStorage`에는 try/catch로 저장).
- [ ] **Step 2: 실패하는 테스트를 쓴다.**
  ```ts
  it('친구 목록 표에 캐릭터별 레이드 체크 칸이 보인다 (캐릭터 × 레이드 이름)');
  it('체크를 바꾸면 PUT /api/clears가 호출되고 공대 후보가 다시 불려온다');
  it('같은 레이드의 두 번째 난이도를 고르면 첫 번째 난이도가 해제된다');
  it('후보 카드에 분배 라벨(3+2), 공대별 평균, 단계(여유/빠듯함/위험/모름), 외부인 수가 보인다');
  it('excluded가 있으면 "가능한 캐릭터 없음" 안내가 보인다');
  it('전투력이 null인 캐릭터 옆에 수동 입력칸이 있다');
  ```
- [ ] **Step 3: 디자인은 `frontend-design:frontend-design` 스킬을 호출해 방향을 정한 뒤 구현한다 (사용자 요청: 디자인에 신경 쓸 것).** 로스트아크 느낌의 어두운 테마, 단계(여유/빠듯함/위험/모름)를 색과 아이콘으로 구분, 읽기 쉬운 한글 타이포그래피를 기본으로 하고 라이트/다크 모두 지원한다. 화면: ① 친구 등록/갱신 ② 친구×캐릭터 표(레이드 이름 열마다 난이도 선택 드롭다운: "안 감/노말/하드/…") ③ 이번 주 돌 레이드 선택(복수)과 참석자 체크 ④ 레이드별 후보 카드. 모바일 폭에서도 가로 스크롤 없이 보이게 한다.
- [ ] **Step 4: 통과 확인 후 `npm run dev`로 브라우저에서 눈으로 확인하고 커밋한다.**

---

### Task 9: 디스코드 봇

**Files:**
- Create: `src/discord/commands.ts`, `src/discord/handler.ts`, `src/app/api/discord/route.ts`, `scripts/register-commands.ts`
- Test: `tests/discord/handler.test.ts`, `tests/discord/route.test.ts`

**Interfaces:**
- Consumes: Store, planRaid, fetchRoster, weekKey, RAIDS.
- Produces:
  ```ts
  export const COMMANDS: { name: string; description: string; options?: unknown[] }[]; // 명령어, 등록, 공대, 클리어, 현황 (모두 한글 설명)
  export async function handleInteraction(body: DiscordInteraction, deps: { store: Store; fetchRoster: typeof fetchRoster; now: () => Date }): Promise<DiscordResponse>;
  ```
  `POST /api/discord`: `X-Signature-Ed25519`, `X-Signature-Timestamp`로 `verifyKey`(`discord-interactions`) 검증 → 실패 시 401. type 1(PING)은 `{type:1}`. 명령어는 `handleInteraction`에 위임.

**동작:**
- `/명령어`: 모든 명령어와 사용법 목록을 ephemeral(`flags: 64`)로 응답.
- `/등록 대표캐릭터`: 즉시 type 5로 응답하고 `after()`에서 로스터를 가져와 `PATCH /webhooks/{appId}/{token}/messages/@original`로 결과를 보낸다. 실행한 디스코드 사용자 ID를 `Friend.discordUserId`로 연결한다.
- `/공대 레이드`: `raid` 선택지(14개, 이름+난이도) → 참석자는 등록된 전원을 기본으로 후보를 텍스트로 응답(분배 라벨, 공대별 구성과 평균, 단계 이모지, 외부 N명).
- `/클리어`: 실행자의 캐릭터를 고르는 선택 메뉴 → 선택하면 그 캐릭터의 **레이드·난이도 다중 선택 메뉴**(체크박스 역할, 현재 클리어한 항목이 기본 선택)를 보여 준다. 제출 시 같은 레이드가 두 난이도 선택되면 오류 메시지, 아니면 `setCharacterClears`.
- `/현황`: 이번 주 전체 클리어 현황을 텍스트 표로.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  ```ts
  it('route: 서명이 틀리면 401 [Review Focus 5]');
  it('route: PING(type 1)에 {type:1}로 응답');
  it('/명령어는 ephemeral이고 모든 COMMANDS 이름을 포함한다');
  it('모든 COMMANDS에 비어 있지 않은 한글 description이 있다');
  it('/등록은 type 5로 먼저 응답한다');
  it('/등록에서 not_found면 "캐릭터를 찾을 수 없어요" 메시지');
  it('/클리어 제출: 같은 레이드 두 난이도면 오류, 정상이면 저장되고 /공대 후보에서 그 캐릭터가 빠진다');
  it('/공대는 후보가 없으면 사유를 문장으로 알려준다');
  ```
  서명 테스트는 `tweetnacl`로 만든 키 쌍을 쓴다.
- [ ] **Step 2: 실패 확인 후 구현하고 통과를 확인한다.**
- [ ] **Step 3: `scripts/register-commands.ts`를 만든다.** `PUT /applications/{appId}/commands`에 `COMMANDS`를 전송(봇 토큰은 환경변수). `npx tsx scripts/register-commands.ts`로 실행한다.
- [ ] **Step 4: 커밋한다.**

---

### Task 10: 크론, 배포 설정, 처음 쓰는 사람용 안내

**Files:**
- Create: `src/app/api/cron/weekly/route.ts`, `vercel.json`, `README.md`
- Test: `tests/api/cron.test.ts`

**Interfaces:**
- Consumes: Store, `weekKey`, `fetchRoster`.
- Produces: `GET /api/cron/weekly` — 헤더 `authorization: Bearer ${CRON_SECRET}`이 아니면 401. 지난주(`weekKey(now − 7일)`) 기록을 삭제하고 등록된 친구의 로스터를 갱신한다 (한 명 실패해도 나머지는 계속, 결과 요약 JSON 반환).

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  ```ts
  it('CRON_SECRET이 다르면 401');
  it('지난주 기록만 삭제하고 이번 주 기록은 남긴다');
  it('한 친구의 로스터 갱신이 실패해도 나머지는 갱신된다');
  ```
- [ ] **Step 2: 구현하고 `vercel.json`에 크론을 등록한다.** 수요일 06:00 KST는 UTC 화요일 21:00이다: `"schedule": "0 21 * * 2"`, `path: "/api/cron/weekly"`. 갱신이 실패해도 weekKey 덕분에 클리어 초기화에는 영향이 없다.
- [ ] **Step 3: `README.md`를 쓴다.** 코딩을 처음 해 본 사람이 따라 할 수 있게, 순서대로: (1) 로스트아크 API 토큰 발급 (2) 디스코드 개발자 포털에서 애플리케이션 생성, Public Key / Application ID / Bot Token 위치, 서버에 봇 초대(`applications.commands` 스코프) (3) Upstash Redis 생성과 REST URL/토큰 (4) Vercel 프로젝트 연결과 환경변수 목록(`LOSTARK_JWT`, `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `APP_PASSWORD`, `CRON_SECRET`) (5) 배포 후 디스코드 "Interactions Endpoint URL"에 `https://<도메인>/api/discord` 입력 (6) 명령어 등록 스크립트 실행 (7) 문제 해결(서명 오류, 429).
- [ ] **Step 4 (USER ACTION, 실행자가 안내): 실제 배포 후 스모크 테스트.** 디스코드에서 `/명령어` → `/등록 <대표캐릭터>` → `/공대 세르카 하드` → `/클리어`를 순서대로 실행해 응답을 확인한다. 웹에서도 같은 친구가 보이는지 확인한다.
- [ ] **Step 5: 커밋한다.**

---

## Self-Review 결과

- **스펙 커버리지:** 목표 1(등록·로스터)=Task 5·7·9, 2(레이드별 후보)=Task 4, 3(캐릭터×레이드 클리어와 재계산)=Task 3·6·7·8·9, 4(주간 초기화)=Task 2·10, 5(웹+디스코드)=Task 7~9, 6(웹 먼저)=Task 8 다음 Task 9. 디스코드 `/`·`/명령어`=Task 9, 외부인/서포터/균형/단계=Task 4, 수동 전투력=Task 6·8.
- **타입 일관성:** `Store`, `Candidate`, `PlanResult`, `ClearRecord`, `fetchRoster` 이름과 시그니처를 Task 1·4~9에서 같게 썼다.
- **스펙과 다른 점 (의도적):** 주간 초기화를 "삭제"가 아니라 `weekKey`로 자동 분리하고 크론은 정리·갱신만 한다 (결과는 동일, 더 단순).
- **미확정 (probe 후 확정):** 전투력의 API 제공 여부, 서포터 직업·각인 판별 기준, 디스코드 체크박스 컴포넌트 사용 여부 (이 계획은 다중 선택 메뉴를 쓴다).
