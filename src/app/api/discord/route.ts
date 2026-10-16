import { after } from 'next/server';
import { verifyKey } from 'discord-interactions';
import { getStore, StoreConfigError, type Store } from '@/store/store';
import { fetchRoster } from '@/lostark/client';
import { handleInteraction } from '@/discord/handler';
import { EPHEMERAL, InteractionType, ResponseType, type DiscordInteraction } from '@/discord/types';

export const maxDuration = 60;

/** Discord Interactions Endpoint. 서명을 원문 그대로 검증한 뒤에만 JSON을 읽는다. */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get('x-signature-ed25519');
  const timestamp = req.headers.get('x-signature-timestamp');
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const valid = !!(signature && timestamp && publicKey)
    && (await verifyKey(raw, signature, timestamp, publicKey).catch(() => false));
  if (!valid) return new Response('invalid request signature', { status: 401 });

  let body: DiscordInteraction;
  try {
    body = JSON.parse(raw) as DiscordInteraction;
  } catch {
    return new Response('bad request', { status: 400 });
  }
  let store: Store;
  try {
    store = getStore();
  } catch (err) {
    if (!(err instanceof StoreConfigError)) throw err;
    // PING은 저장소 없이 답할 수 있다. 나머지는 실행한 사람에게만 설정 안내를 보여 준다.
    if (body?.type === InteractionType.PING) return Response.json({ type: ResponseType.PONG });
    return Response.json({ type: ResponseType.CHANNEL_MESSAGE, data: { content: `⚠️ ${err.message}`, flags: EPHEMERAL } });
  }
  const { response, after: work } = await handleInteraction(body, { store, fetchRoster, now: () => new Date() });
  if (work) after(work);
  return Response.json(response);
}
