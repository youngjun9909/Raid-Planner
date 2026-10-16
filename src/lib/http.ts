import { checkPassword } from '@/lib/auth';
import { LostArkError } from '@/lostark/client';

export const errorResponse = (error: string, status: number) => Response.json({ error }, { status });

export const unauthorized = () => errorResponse('비밀번호가 올바르지 않아요', 401);

/** Returns a 401 Response when the password is wrong, otherwise null. */
export function guard(req: Request): Response | null {
  return checkPassword(req) ? null : unauthorized();
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const badRequest = (msg = '요청 형식이 올바르지 않아요') => errorResponse(msg, 400);

export const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const STATUS = { not_found: 404, rate_limited: 429, unauthorized: 502, unknown: 502 } as const;

export function lostArkErrorResponse(err: unknown): Response {
  if (err instanceof LostArkError) return errorResponse(err.message, STATUS[err.code]);
  throw err;
}
