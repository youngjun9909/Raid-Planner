const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const RESET_HOUR_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEDNESDAY = 3;

/** 가장 최근 수요일 06:00 KST의 날짜를 YYYY-MM-DD로 반환한다. 로컬 타임존에 의존하지 않는다. */
export function weekKey(now: Date): string {
  // KST로 옮기고 6시간을 빼서 "리셋 기준 날짜"를 UTC getter로 읽는다.
  const shifted = new Date(now.getTime() + KST_OFFSET_MS - RESET_HOUR_MS);
  const daysSinceWed = (shifted.getUTCDay() - WEDNESDAY + 7) % 7;
  const wed = new Date(shifted.getTime() - daysSinceWed * DAY_MS);
  return wed.toISOString().slice(0, 10);
}
