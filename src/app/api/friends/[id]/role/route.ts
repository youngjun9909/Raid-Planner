import { getStore } from '@/store/store';
import { visibleCharacters, visibleFriend } from '@/core/visible';
import { badRequest, errorResponse, guard, isNonEmptyString, readJson, withConfigErrors } from '@/lib/http';

/** 캐릭터 역할 수동 지정. body: { characterName, role: 'support' | 'dealer' | null } (null이면 자동 판별로). */
export const PUT = withConfigErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const store = getStore();
  const friend = await store.getFriend(id);
  if (!friend) return errorResponse('친구를 찾을 수 없어요', 404);
  const body = await readJson(req);
  if (!body || !isNonEmptyString(body.characterName)) return badRequest('캐릭터 이름이 필요해요');
  const role = body.role;
  if (role !== null && role !== 'support' && role !== 'dealer') {
    return badRequest('역할은 support, dealer 또는 null이어야 해요');
  }
  if (!visibleCharacters(friend.characters).some((c) => c.name === body.characterName)) {
    return badRequest('이 친구의 캐릭터가 아니에요');
  }
  await store.setManualRole(id, body.characterName, role);
  const saved = await store.getFriend(id);
  return Response.json(saved && visibleFriend(saved));
});
