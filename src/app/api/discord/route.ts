import { after } from 'next/server';
import { verifyKey } from 'discord-interactions';
import { getStore } from '@/store/store';
import { fetchRoster } from '@/lostark/client';
import { handleInteraction } from '@/discord/handler';
import type { DiscordInteraction } from '@/discord/types';

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
  const { response, after: work } = await handleInteraction(body, { store: getStore(), fetchRoster, now: () => new Date() });
  if (work) after(work);
  return Response.json(response);
}
