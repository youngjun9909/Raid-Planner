import { createHash, randomUUID } from 'node:crypto';
import type { Store } from '@/store/store';
import { LostArkError, type LostArkErrorCode, type fetchRoster as FetchRoster } from '@/lostark/client';
import { getRaid, RAIDS } from '@/core/raids';
import { planRaid } from '@/core/planner';
import { proficiencyLookup } from '@/core/proficiency';
import { weekKey } from '@/core/week';
import type { Character, ClearRecord, Friend, RaidConfig } from '@/core/types';
import { applyClearChange, formatLevel } from '@/lib/view-model';
import { getWebUrl } from '@/lib/web-url';
import { findOwner } from '@/lib/friend-dupes';
import { COMMANDS, raidTitle } from './commands';
import {
  characterClearsEmbed, errorParts, formatHelp, formatPlan, formatStatus, registerSuccess,
  NO_FRIENDS_TEXT, webLinkParts, type MessageParts,
} from './format';
import { ICON } from './theme';
import {
  EPHEMERAL, InteractionType, ResponseType,
  type ActionRow, type DiscordInteraction, type DiscordResponse, type DiscordUser,
} from './types';

export interface Deps {
  store: Store;
  fetchRoster: typeof FetchRoster;
  now: () => Date;
  /** 후속 메시지(PATCH)에 쓸 fetch. 테스트에서 주입한다. */
  fetch?: typeof fetch;
}

export interface HandlerResult {
  response: DiscordResponse;
  /** 응답을 보낸 뒤 실행할 작업 (라우트에서 next/server의 after()로 예약). */
  after?: () => Promise<void>;
}

export const UNKNOWN_TEXT = '알 수 없는 명령이에요';
export const GENERIC_ERROR_TEXT = '문제가 생겼어요. 잠시 후 다시 시도해 주세요';
const DUPLICATE_RAID_TEXT = '한 레이드는 한 난이도만 선택할 수 있어요';
const DISCORD_API = 'https://discord.com/api/v10';

/** 원인 → 해결 방법 (오류 임베드의 두 번째 줄). */
const FIX = {
  unknown: '`/명령어`로 사용할 수 있는 명령어를 확인해 주세요.',
  generic: '잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.',
  registerFirst: '`/등록 대표캐릭터:홍길동`처럼 내 캐릭터 이름을 넣으면 돼요.',
  notMine: '`/클리어`를 직접 실행해서 내 캐릭터를 골라 주세요.',
  taken: '내 캐릭터가 맞다면 관리자에게 연결을 풀어 달라고 부탁해 주세요.',
  otherFriend: '내 캐릭터가 맞다면 웹 화면에서 그 친구를 삭제한 뒤 다시 `/등록` 해 주세요.',
  noCharacters: '`/등록`을 다시 실행해서 원정대를 새로 불러와 주세요.',
  unknownRaid: '`/공대`에서 목록에 있는 레이드를 골라 주세요.',
  rerun: '`/클리어`를 다시 실행해서 최신 메뉴로 골라 주세요.',
};
const LOSTARK_FIX: Record<LostArkErrorCode, string> = {
  not_found: '캐릭터 이름의 철자를 확인하고 다시 `/등록` 해 주세요.',
  rate_limited: '1분 정도 기다렸다가 다시 시도해 주세요.',
  unauthorized: '관리자에게 로스트아크 API 토큰 설정을 확인해 달라고 해 주세요.',
  unknown: '잠시 후 다시 시도해 주세요.',
};

const NO_MENTIONS = { parse: [] as string[] };
const reply = (p: MessageParts): DiscordResponse =>
  ({ type: ResponseType.CHANNEL_MESSAGE, data: { ...p, allowed_mentions: NO_MENTIONS } });
const privately = (p: MessageParts): DiscordResponse =>
  ({ type: ResponseType.CHANNEL_MESSAGE, data: { ...p, flags: EPHEMERAL, allowed_mentions: NO_MENTIONS } });
const update = (p: MessageParts): DiscordResponse =>
  ({ type: ResponseType.UPDATE_MESSAGE, data: { components: [], ...p, allowed_mentions: NO_MENTIONS } });
const only = (response: DiscordResponse): HandlerResult => ({ response });

const invoker = (body: DiscordInteraction): DiscordUser | undefined => body.member?.user ?? body.user;
const option = (body: DiscordInteraction, name: string): unknown => body.data?.options?.find((o) => o.name === name)?.value;

async function findMe(body: DiscordInteraction, store: Store): Promise<Friend | undefined> {
  const user = invoker(body);
  if (!user) return undefined;
  return (await store.listFriends()).find((f) => f.discordUserId === user.id);
}

export async function handleInteraction(body: DiscordInteraction, deps: Deps): Promise<HandlerResult> {
  // 오류 메시지를 만들 때도 now()가 필요하므로 미리 잡아 둔다.
  const fail = (cause: string, fix: string) => only(privately(errorParts(cause, fix, deps.now())));
  try {
    switch (body?.type) {
      case InteractionType.PING: return only({ type: ResponseType.PONG });
      case InteractionType.APPLICATION_COMMAND: return await onCommand(body, deps, fail);
      case InteractionType.MESSAGE_COMPONENT: return await onComponent(body, deps, fail);
      default: return fail(UNKNOWN_TEXT, FIX.unknown);
    }
  } catch (err) {
    // 오류 내용에는 토큰 등 민감한 값이 섞일 수 있어 이름만 남긴다.
    console.error('discord interaction failed:', err instanceof Error ? err.name : typeof err);
    try {
      return fail(GENERIC_ERROR_TEXT, FIX.generic);
    } catch {
      return only({ type: ResponseType.CHANNEL_MESSAGE, data: { content: GENERIC_ERROR_TEXT, flags: EPHEMERAL } });
    }
  }
}

type Fail = (cause: string, fix: string) => HandlerResult;

async function onCommand(body: DiscordInteraction, deps: Deps, fail: Fail): Promise<HandlerResult> {
  switch (body.data?.name) {
    case '명령어': return only(privately(formatHelp(COMMANDS, deps.now())));
    case '등록': return onRegister(body, deps, fail);
    case '공대': {
      const raid = getRaid(String(option(body, '레이드') ?? ''));
      return raid ? planFor(raid, deps, reply, fail) : fail('알 수 없는 레이드예요', FIX.unknownRaid);
    }
    case '클리어': return onClearStart(body, deps, fail);
    case '웹': return only(privately(webLinkParts(getWebUrl(), deps.now())));
    case '현황': return only(await onStatus(deps));
    default: return fail(UNKNOWN_TEXT, FIX.unknown);
  }
}

// ---------- /등록 ----------

function onRegister(body: DiscordInteraction, deps: Deps, fail: Fail): HandlerResult {
  const name = String(option(body, '대표캐릭터') ?? '').trim();
  const user = invoker(body);
  if (!name) return fail('대표 캐릭터 이름을 입력해 주세요', FIX.registerFirst);
  if (!user) return fail(GENERIC_ERROR_TEXT, FIX.generic);
  const displayName = body.member?.nick || user.global_name || user.username || name;
  return {
    // 결과(특히 "다른 계정에 연결됨" 같은 거절)는 실행한 사람에게만 보이게 한다. 후속 PATCH도 이 플래그를 따른다.
    response: { type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } },
    after: async () => {
      let message: MessageParts;
      try {
        message = await register(name, user.id, displayName, deps);
      } catch (err) {
        if (err instanceof LostArkError) {
          message = errorParts(err.message, LOSTARK_FIX[err.code], deps.now());
        } else {
          console.error('discord register failed:', err instanceof Error ? err.name : typeof err);
          message = errorParts(GENERIC_ERROR_TEXT, FIX.generic, deps.now());
        }
      }
      await followUp(body, message, deps);
    },
  };
}

async function register(name: string, userId: string, displayName: string, deps: Deps): Promise<MessageParts> {
  const friends = await deps.store.listFriends();
  const owns = (f: Friend) => f.representativeName === name || f.characters.some((c) => c.name === name);
  const taken = friends.find((f) => f.discordUserId && f.discordUserId !== userId && owns(f));
  if (taken) return errorParts(`${name} 캐릭터는 이미 다른 디스코드 계정(${taken.displayName})에 연결되어 있어요`, FIX.taken, deps.now());
  // 이미 연결된 내 친구 → 같은 캐릭터의 미연결 친구(웹에서 등록) → 새 친구 순서로 고른다.
  const target = friends.find((f) => f.discordUserId === userId) ?? friends.find((f) => !f.discordUserId && owns(f));
  // 내 친구(target)는 갱신할 수 있지만, 다른 친구의 캐릭터를 가져올 수는 없다 (클리어/배치가 캐릭터 이름으로 묶임).
  const other = findOwner(friends, [name], target?.id);
  if (other) return errorParts(`${name}은(는) 이미 다른 친구(${other.displayName})로 등록된 캐릭터예요`, FIX.otherFriend, deps.now());
  const characters = await deps.fetchRoster(name);
  const overlap = findOwner(await deps.store.listFriends(), characters.map((c) => c.name), target?.id);
  if (overlap) {
    return errorParts(`불러온 원정대에 이미 다른 친구(${overlap.displayName})로 등록된 캐릭터가 있어요`, FIX.otherFriend, deps.now());
  }
  const saved: Friend = target
    ? { ...target, discordUserId: userId, representativeName: name, characters }
    : { id: randomUUID(), displayName, discordUserId: userId, representativeName: name, characters };
  await deps.store.saveFriend(saved);
  return registerSuccess({ displayName: saved.displayName, representativeName: name, characters, updated: !!target, now: deps.now() });
}

/** 지연 응답(type 5)의 원래 메시지를 결과로 바꾼다. 인터랙션 웹훅이라 봇 토큰이 필요 없다. */
async function followUp(body: DiscordInteraction, message: MessageParts, deps: Deps): Promise<void> {
  const appId = body.application_id ?? process.env.DISCORD_APP_ID;
  if (!appId || !body.token) return;
  const url = `${DISCORD_API}/webhooks/${appId}/${body.token}/messages/@original`;
  try {
    const res = await (deps.fetch ?? fetch)(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...message, allowed_mentions: NO_MENTIONS }),
    });
    if (!res.ok) console.error('discord follow-up failed: status', res.status);
  } catch (err) {
    console.error('discord follow-up failed:', err instanceof Error ? err.name : typeof err);
  }
}

// ---------- /공대, /현황 ----------

async function planFor(raid: RaidConfig, deps: Deps, wrap: (p: MessageParts) => DiscordResponse, fail: Fail): Promise<HandlerResult> {
  const [friends, clears] = await Promise.all([deps.store.listFriends(), deps.store.getClears(weekKey(deps.now()))]);
  if (friends.length === 0) return fail(NO_FRIENDS_TEXT, FIX.registerFirst);
  const result = planRaid({ raid, friends, clears, attendeeIds: friends.map((f) => f.id), proficiency: proficiencyLookup(friends, raid.name) });
  return only(wrap(formatPlan(raid, result, friends, deps.now())));
}

async function onStatus(deps: Deps): Promise<DiscordResponse> {
  const [friends, clears] = await Promise.all([deps.store.listFriends(), deps.store.getClears(weekKey(deps.now()))]);
  return reply(formatStatus(friends, clears, deps.now()));
}

// ---------- /클리어 ----------
//
// custom_id 형식
//   캐릭터 선택: clr:c:<friendId>            (option value = 캐릭터 참조)
//   레이드 선택: clr:r:<friendId>:<weekKey>:<캐릭터 참조>
// 캐릭터 참조는 이름 그대로이고, custom_id 100자에 들어가지 않으면 '#' + sha256(이름) 앞 16자리.
// 순번 대신 이름을 쓰므로 단계 사이에 원정대가 갱신돼도 다른 캐릭터에 저장되지 않는다.
// weekKey를 담아 두어 메뉴를 연 뒤 주간 초기화가 지나면 지난주 선택을 이번 주에 쓰지 않는다.

const MAX_SELECT_OPTIONS = 25;
const MAX_CUSTOM_ID = 100;
const clip = (s: string, n = 100) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const STALE_CHARACTER_TEXT = '캐릭터 목록이 바뀌었어요. `/클리어`를 다시 실행해 주세요';
const STALE_WEEK_TEXT = '새로운 주가 시작됐어요. `/클리어`를 다시 실행해 주세요';

const hashRef = (name: string) => `#${createHash('sha256').update(name).digest('hex').slice(0, 16)}`;
const raidSelectId = (friendId: string, week: string, ref: string) => `clr:r:${friendId}:${week}:${ref}`;

/** 캐릭터 참조: 레이드 메뉴 custom_id에 이름이 들어가면 이름, 아니면 짧은 해시. 두 단계 모두 같은 값을 쓴다. */
function characterRef(friendId: string, week: string, name: string): string {
  return raidSelectId(friendId, week, name).length <= MAX_CUSTOM_ID ? name : hashRef(name);
}

function resolveCharacter(friend: Friend, ref: string): Character | undefined {
  return friend.characters.find((c) => c.name === ref)
    ?? (ref.startsWith('#') ? friend.characters.find((c) => hashRef(c.name) === ref) : undefined);
}

function characterRow(friend: Friend, week: string, selected?: string): ActionRow {
  const options = [...friend.characters]
    .sort((a, b) => b.itemLevel - a.itemLevel)
    .slice(0, MAX_SELECT_OPTIONS)
    .map((c) => ({
      label: clip(c.name),
      value: characterRef(friend.id, week, c.name),
      description: clip(`${c.role === 'support' ? '서포터' : '딜러'} · ${c.className} · ${formatLevel(c.itemLevel)}`),
      ...(c.name === selected ? { default: true } : {}),
    }));
  return { type: 1, components: [{ type: 3, custom_id: `clr:c:${friend.id}`, placeholder: '캐릭터를 골라 주세요', options }] };
}

function raidRow(friend: Friend, week: string, name: string, clears: ClearRecord[]): ActionRow {
  const done = (r: RaidConfig) => clears.some((c) => c.characterName === name && c.raidName === r.name && c.difficulty === r.difficulty);
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: raidSelectId(friend.id, week, characterRef(friend.id, week, name)),
      placeholder: '이번 주에 클리어한 레이드를 모두 골라 주세요',
      min_values: 0,
      max_values: RAIDS.length,
      options: RAIDS.map((r) => ({ label: raidTitle(r), value: r.id, ...(done(r) ? { default: true } : {}) })),
    }],
  };
}

async function onClearStart(body: DiscordInteraction, deps: Deps, fail: Fail): Promise<HandlerResult> {
  const me = await findMe(body, deps.store);
  if (!me) return fail('먼저 `/등록`으로 대표 캐릭터를 등록해 주세요', FIX.registerFirst);
  if (me.characters.length === 0) return fail('등록된 캐릭터가 없어요', FIX.noCharacters);
  const week = weekKey(deps.now());
  return only(privately({ content: `${ICON.clear} 클리어를 표시할 캐릭터를 골라 주세요`, embeds: [], components: [characterRow(me, week)] }));
}

const inMenu = (r: { raidName: string; difficulty: string }) =>
  RAIDS.some((x) => x.name === r.raidName && x.difficulty === r.difficulty);

async function onComponent(body: DiscordInteraction, deps: Deps, fail: Fail): Promise<HandlerResult> {
  const [prefix, kind, friendId, ...rest] = (body.data?.custom_id ?? '').split(':');

  if (prefix === 'plan') {
    const raid = kind ? getRaid(kind) : undefined;
    return raid ? planFor(raid, deps, update, fail) : fail(UNKNOWN_TEXT, FIX.unknown);
  }
  if (prefix === 'clr' && kind === 'start') return onClearStart(body, deps, fail);
  if (prefix !== 'clr' || (kind !== 'c' && kind !== 'r') || !friendId) return fail(UNKNOWN_TEXT, FIX.unknown);

  const me = await findMe(body, deps.store);
  if (!me) return fail('먼저 `/등록`으로 대표 캐릭터를 등록해 주세요', FIX.registerFirst);
  if (me.id !== friendId) return fail('내 캐릭터만 바꿀 수 있어요', FIX.notMine);
  const week = weekKey(deps.now());
  const values = body.data?.values ?? [];
  // 레이드 메뉴: 메뉴를 그린 주가 지금 주와 다르면 거절 (예전 순번 형식도 여기서 걸러진다).
  if (kind === 'r' && rest[0] !== week) return fail(STALE_WEEK_TEXT, FIX.rerun);
  const ref = kind === 'c' ? values[0] : rest.slice(1).join(':');
  const character = ref ? resolveCharacter(me, ref) : undefined;
  if (!character) return fail(STALE_CHARACTER_TEXT, FIX.rerun);
  const clears = await deps.store.getClears(week);
  const view = (content: string, cs: ClearRecord[]): MessageParts => ({
    content,
    embeds: [characterClearsEmbed(character, cs, deps.now())],
    components: [characterRow(me, week, character.name), raidRow(me, week, character.name, cs)],
  });

  if (kind === 'c') {
    return only(update(view(`**${character.name}**의 이번 주 클리어를 모두 골라 주세요 (한 레이드는 한 난이도만)`, clears)));
  }

  const raids = values.map((v) => getRaid(v));
  if (raids.some((r) => r === undefined)) return fail(UNKNOWN_TEXT, FIX.unknown);
  const chosen = raids as RaidConfig[];
  if (new Set(chosen.map((r) => r.name)).size !== chosen.length) {
    return only(update(view(`${ICON.error} ${DUPLICATE_RAID_TEXT}. 다시 골라 주세요.`, clears)));
  }
  // 의도된 동작: 레이드 메뉴는 RAIDS 전체(14개)를 담으므로 제출한 선택이 그 캐릭터의 "메뉴에 있는 레이드" 전체 기록을 대신한다
  // (메뉴를 연 뒤 웹에서 같은 레이드를 바꿨다면 제출한 선택이 이긴다). 메뉴에 없는 기록(설정에서 빠진 레이드 등)은
  // 메뉴의 기본값이 아니라 지금 저장된 값에서 가져와 그대로 남긴다.
  const kept = clears
    .filter((c) => c.characterName === character.name && !inMenu(c))
    .map(({ raidName, difficulty }) => ({ raidName, difficulty }));
  const records = [...chosen.map((r) => ({ raidName: r.name, difficulty: r.difficulty })), ...kept];
  await deps.store.setCharacterClears(week, character.name, records);
  return only(update(view(`${ICON.clear} ${character.name} 클리어 ${chosen.length}건 저장했어요`, applyClearChange(clears, character.name, records))));
}
