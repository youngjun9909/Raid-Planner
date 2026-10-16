import { getStore } from '@/store/store';
import { isProficiency, RAID_NAMES_FOR_PROFICIENCY } from '@/core/proficiency';
import { badRequest, errorResponse, guard, isNonEmptyString, readJson, withConfigErrors } from '@/lib/http';

/**
 * 숙련도 지정. body: { characterName, raidName, level: '숙련' | '반숙' | '클경' | null } (null이면 기본값 반숙으로).
 * raidName은 난이도 없는 레이드 이름(RAIDS의 name). 응답은 숙련도가 붙은 친구.
 */
export const PUT = withConfigErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const store = getStore();
  const friend = await store.getFriend(id);
  if (!friend) return errorResponse('친구를 찾을 수 없어요', 404);
  const body = await readJson(req);
  if (!body || !isNonEmptyString(body.characterName)) return badRequest('캐릭터 이름이 필요해요');
  if (typeof body.raidName !== 'string' || !RAID_NAMES_FOR_PROFICIENCY.includes(body.raidName)) {
    return badRequest('알 수 없는 레이드예요');
  }
  const level = body.level;
  if (level !== null && !isProficiency(level)) return badRequest('숙련도는 숙련, 반숙, 클경 또는 null이어야 해요');
  if (!friend.characters.some((c) => c.name === body.characterName)) {
    return badRequest('이 친구의 캐릭터가 아니에요');
  }
  await store.setProficiency(id, body.characterName, body.raidName, level);
  return Response.json(await store.getFriend(id));
});
