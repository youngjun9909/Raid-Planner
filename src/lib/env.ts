/** 배포 환경(Vercel 또는 NODE_ENV=production)인지. 이때는 설정 누락을 조용히 넘기지 않는다. */
export function isProduction(): boolean {
  return !!process.env.VERCEL || process.env.NODE_ENV === 'production';
}
