/**
 * Lost Ark Open API client.
 *
 * UNVERIFIED ASSUMPTIONS (built from documented shapes, no real token was used;
 * run `npx tsx scripts/probe-lostark.ts <대표캐릭터>` and correct as needed):
 *  1. Base URL https://developer-lostark.game.onstove.com, header `authorization: bearer <JWT>`.
 *  2. GET /characters/{name}/siblings returns a JSON array of
 *     { ServerName, CharacterName, CharacterClassName, ItemAvgLevel: "1,620.00", ... };
 *     unknown name -> 404, or null/[] body.
 *  3. GET /armories/characters/{name}/profiles returns an object with
 *     CombatPower as a string ("3,150.25") or null; may be absent -> combatPower null.
 *  4. Engraving names (for detectRole) may live under ArkPassive.Effects[].Name/Description;
 *     exact location unknown, so we collect strings defensively.
 *  5. Rate limit 100 req/min -> sequential profile calls with a gap (default 700ms); 429 aborts.
 *  6. SUPPORT_CLASSES is provisional. TODO(probe): decide whether engravings are needed
 *     to tell supports apart and refine detectRole accordingly.
 */
import type { Character, Role } from '@/core/types';
import { SUPPORT_CLASSES } from '@/core/raids';

const BASE_URL = 'https://developer-lostark.game.onstove.com';

const MESSAGES = {
  not_found: '캐릭터를 찾을 수 없어요',
  rate_limited: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요',
  unauthorized: '로스트아크 API 토큰이 올바르지 않아요',
  unknown: '로스트아크 API 호출에 실패했어요',
} as const;

export type LostArkErrorCode = keyof typeof MESSAGES;

export class LostArkError extends Error {
  constructor(public code: LostArkErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = 'LostArkError';
  }
}

export interface FetchRosterOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
}

export function parseItemLevel(s: string): number {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseCombatPower(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function detectRole(className: string, engravings: string[]): Role {
  // TODO(probe): engravings are the hook for refinement; for now the class decides.
  void engravings;
  return SUPPORT_CLASSES.includes(className) ? 'support' : 'dealer';
}

function collectEngravings(profile: any): string[] {
  const out: string[] = [];
  const effects = profile?.ArkPassive?.Effects;
  if (Array.isArray(effects)) {
    for (const e of effects) {
      for (const k of ['Name', 'Description']) if (typeof e?.[k] === 'string') out.push(e[k]);
    }
  }
  return out;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function get(url: string, token: string, f: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url, { headers: { accept: 'application/json', authorization: `bearer ${token}` } });
  } catch {
    throw new LostArkError('unknown');
  }
  if (res.status === 401 || res.status === 403) throw new LostArkError('unauthorized');
  if (res.status === 429) throw new LostArkError('rate_limited');
  if (res.status === 404) throw new LostArkError('not_found');
  if (!res.ok) throw new LostArkError('unknown');
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchRoster(representativeName: string, opts: FetchRosterOptions = {}): Promise<Character[]> {
  const token = opts.token ?? process.env.LOSTARK_JWT;
  if (!token) throw new LostArkError('unauthorized');
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const delayMs = opts.delayMs ?? 700;

  const siblings = await get(`${BASE_URL}/characters/${encodeURIComponent(representativeName)}/siblings`, token, f);
  if (!Array.isArray(siblings) || siblings.length === 0) throw new LostArkError('not_found');

  const roster: Character[] = [];
  for (const s of siblings as any[]) {
    const name = String(s?.CharacterName ?? '');
    if (!name) continue;
    const className = String(s?.CharacterClassName ?? '');
    if (roster.length > 0) await sleep(delayMs);
    let combatPower: number | null = null;
    let engravings: string[] = [];
    try {
      const profile: any = await get(`${BASE_URL}/armories/characters/${encodeURIComponent(name)}/profiles`, token, f);
      combatPower = parseCombatPower(profile?.CombatPower);
      engravings = collectEngravings(profile);
    } catch (e) {
      // Per-character not_found/unknown are tolerated; auth and rate limit abort.
      if (e instanceof LostArkError && (e.code === 'rate_limited' || e.code === 'unauthorized')) throw e;
    }
    roster.push({ name, className, role: detectRole(className, engravings), itemLevel: parseItemLevel(s?.ItemAvgLevel), combatPower });
  }
  return roster;
}
