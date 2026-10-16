import { passwordStatus } from '@/lib/auth';
import { LostArkError } from '@/lostark/client';
import { StoreConfigError } from '@/store/store';

export const errorResponse = (error: string, status: number) => Response.json({ error }, { status });

/**
 * 라우트 핸들러를 감싸 설정 오류(저장소 env 누락)를 503 한글 JSON으로 바꾼다.
 * 그 밖의 예외는 그대로 던진다(Next가 500으로 처리).
 */
export function withConfigErrors<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof StoreConfigError) return errorResponse(err.message, 503);
      throw err;
    }
  };
}

export const unauthorized = () => errorResponse('비밀번호가 올바르지 않아요', 401);

export const passwordUnconfigured = () => errorResponse('APP_PASSWORD를 설정해 주세요', 503);

/** 비밀번호가 틀리면 401, 배포 환경인데 APP_PASSWORD가 없으면 503, 통과하면 null. */
export function guard(req: Request): Response | null {
  const status = passwordStatus(req);
  if (status === 'ok') return null;
  return status === 'unconfigured' ? passwordUnconfigured() : unauthorized();
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
