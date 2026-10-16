import { randomUUID } from 'node:crypto';
import { getStore } from '@/store/store';
import { fetchRoster } from '@/lostark/client';
import { badRequest, guard, isNonEmptyString, lostArkErrorResponse, readJson, withConfigErrors } from '@/lib/http';

export const maxDuration = 60;

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
  try {
    const characters = await fetchRoster(representativeName);
    const friend = { id: randomUUID(), displayName, representativeName, characters };
    await getStore().saveFriend(friend);
    return Response.json(friend);
  } catch (err) {
    return lostArkErrorResponse(err);
  }
});
