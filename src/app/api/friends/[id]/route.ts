import { getStore } from '@/store/store';
import { weekKey } from '@/core/week';
import { errorResponse, guard, withConfigErrors } from '@/lib/http';

/** 친구 삭제: 원정대, 수동 전투력/역할, 이번 주 그 친구 캐릭터들의 클리어 기록을 지운다. */
export const DELETE = withConfigErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const removed = await getStore().deleteFriend(id, weekKey(new Date()));
  if (!removed) return errorResponse('친구를 찾을 수 없어요', 404);
  return Response.json({ ok: true });
});
