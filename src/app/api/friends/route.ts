import { randomUUID } from 'node:crypto';
import { getStore } from '@/store/store';
import { fetchRoster } from '@/lostark/client';
import { findOwner } from '@/lib/friend-dupes';
import { badRequest, errorResponse, guard, isNonEmptyString, lostArkErrorResponse, readJson, withConfigErrors } from '@/lib/http';

export const maxDuration = 60;

const duplicate = () => errorResponse('이미 등록된 캐릭터예요', 409);

export const GET = withConfigErrors(async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(await getStore().listFriends());
});

export const POST = withConfigErrors(async (req: Request) => {
  const denied = guard(req);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body || !isNonEmptyString(body.displayName) || !isNonEmptyString(body.representativeName)) {
    return badRequest('표시 이름과 대표 캐릭터 이름을 입력해 주세요');
  }
  const displayName = body.displayName.trim();
  const representativeName = body.representativeName.trim();
  const store = getStore();
  // 로스트아크 API를 부르기 전에 대표 캐릭터 이름부터 확인하고, 불러온 원정대도 다시 확인한다.
  if (findOwner(await store.listFriends(), [representativeName])) return duplicate();
  try {
    const characters = await fetchRoster(representativeName);
    if (findOwner(await store.listFriends(), characters.map((c) => c.name))) return duplicate();
    const friend = { id: randomUUID(), displayName, representativeName, characters };
    await store.saveFriend(friend);
    return Response.json(friend);
  } catch (err) {
    return lostArkErrorResponse(err);
  }
});
