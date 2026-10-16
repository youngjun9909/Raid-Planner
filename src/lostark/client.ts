/**
 * Lost Ark Open API client.
 *
 * UNVERIFIED ASSUMPTIONS (built from documented shapes, no real token was used;
 * run `npx tsx scripts/probe-lostark.ts <대표캐릭터>` and correct as needed):
 *  1. Base URL https://developer-lostark.game.onstove.com, header `authorization: bearer <JWT>`.
 *  2. GET /characters/{name}/siblings returns a JSON array of
 *     { ServerName, CharacterName, CharacterClassName, ItemAvgLevel: "1,620.00", ... };
 *     unknown name -> 404, or null/[] body. The list spans every server of the account; we keep
 *     only the representative's ServerName (UNVERIFIED: skipped when ServerName is absent or the
 *     representative is not in the list).
 *  3. GET /armories/characters/{name}/profiles returns an object with
 *     CombatPower as a string ("3,150.25") or null; may be absent -> combatPower null.
 *  4. Engraving names (for detectRole) may live under ArkPassive.Effects[].Name/Description;
 *     exact location unknown, so we collect strings defensively.
 *  5. Rate limit 100 req/min -> sequential profile calls with a gap (default 700ms); 429 aborts.
 *     Characters below the lowest raid minLevel get no profile call (combatPower null).
 *  6. Role detection is by class: SUPPORT_CLASSES (홀리나이트, 도화가, 바드, 발키리) is
 *     user-confirmed (2026-10-16). Odd cases use the manual role override (PUT /api/friends/[id]/role).
 *     Engravings are still collected but not used.
 */
import type { Character, Role } from '@/core/types';
import { RAIDS, SUPPORT_CLASSES } from '@/core/raids';

const BASE_URL = 'https://developer-lostark.game.onstove.com';

/** 가장 낮은 레이드 입장 레벨. 이보다 낮은 캐릭터는 프로필(전투력)을 조회하지 않는다. */
export const MIN_RAID_LEVEL = Math.min(...RAIDS.map((r) => r.minLevel));

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
  // 직업으로 판별한다 (서포터 직업 목록은 사용자 확인). engravings는 나중을 위해 받아만 둔다.
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

/** 레이드는 서버별이라 대표 캐릭터와 같은 서버의 캐릭터만 남긴다. ServerName을 알 수 없으면 그대로 둔다. */
function sameServer(siblings: any[], representativeName: string): any[] {
  const rep = siblings.find((s) => s?.CharacterName === representativeName);
  const server = typeof rep?.ServerName === 'string' && rep.ServerName ? rep.ServerName : undefined;
  return server ? siblings.filter((s) => s?.ServerName === server) : siblings;
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
  let profileCalls = 0;
  for (const s of sameServer(siblings as any[], representativeName)) {
    const name = String(s?.CharacterName ?? '');
    if (!name) continue;
    const className = String(s?.CharacterClassName ?? '');
    const itemLevel = parseItemLevel(s?.ItemAvgLevel);
    let combatPower: number | null = null;
    let engravings: string[] = [];
    // 어떤 레이드에도 못 들어가는 캐릭터는 전투력이 필요 없으니 프로필을 부르지 않는다 (주간 크론 시간/요청 수 절약).
    if (itemLevel >= MIN_RAID_LEVEL) {
      if (profileCalls++ > 0) await sleep(delayMs);
      try {
        const profile: any = await get(`${BASE_URL}/armories/characters/${encodeURIComponent(name)}/profiles`, token, f);
        combatPower = parseCombatPower(profile?.CombatPower);
        engravings = collectEngravings(profile);
      } catch (e) {
        // Per-character not_found/unknown are tolerated; auth and rate limit abort.
        if (e instanceof LostArkError && (e.code === 'rate_limited' || e.code === 'unauthorized')) throw e;
      }
    }
    roster.push({ name, className, role: detectRole(className, engravings), itemLevel, combatPower });
  }
  return roster;
}
