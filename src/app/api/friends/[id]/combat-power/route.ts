import { getStore } from '@/store/store';
import { badRequest, errorResponse, guard, isNonEmptyString, readJson, withConfigErrors } from '@/lib/http';

export const PUT = withConfigErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const store = getStore();
  const friend = await store.getFriend(id);
  if (!friend) return errorResponse('친구를 찾을 수 없어요', 404);
  const body = await readJson(req);
  if (!body || !isNonEmptyString(body.characterName)) return badRequest('캐릭터 이름이 필요해요');
  const cp = body.cp;
  if (cp !== null && !(typeof cp === 'number' && Number.isFinite(cp) && cp >= 0)) {
    return badRequest('전투력은 0 이상의 숫자이거나 null이어야 해요');
  }
  if (!friend.characters.some((c) => c.name === body.characterName)) {
    return badRequest('이 친구의 캐릭터가 아니에요');
  }
  await store.setManualCombatPower(id, body.characterName, cp);
  return Response.json(await store.getFriend(id));
});
