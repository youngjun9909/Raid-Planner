/** 웹 화면 주소. 디스코드 `/웹` 버튼이 쓴다. 비밀번호나 토큰은 절대 넣지 않는다. */
export const DEFAULT_WEB_URL = 'https://goawon-raid-planner.vercel.app';

/** WEB_URL이 올바른 https 주소(사용자 정보/쿼리/해시 없음)면 그 값(끝의 / 제거), 아니면 기본 주소. */
export function getWebUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.WEB_URL?.trim();
  if (!raw) return DEFAULT_WEB_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.search || u.hash) return DEFAULT_WEB_URL;
    return raw.replace(/\/+$/, '');
  } catch {
    return DEFAULT_WEB_URL;
  }
}
