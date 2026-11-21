function limitFrom(raw: string | null | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

const DEFAULT_IP_PER_MIN = 8;
const DEFAULT_BOT_PER_MIN = 20;

export function webCallRateLimits(request: Request): { ipPerMin: number; botPerMin: number } {
  const playwright = process.env.PLAYWRIGHT_TEST === 'true';
  let ipPerMin = limitFrom(process.env.WEB_CALL_RATE_LIMIT_IP_PER_MIN, playwright ? 10_000 : DEFAULT_IP_PER_MIN);
  let botPerMin = limitFrom(process.env.WEB_CALL_RATE_LIMIT_BOT_PER_MIN, playwright ? 10_000 : DEFAULT_BOT_PER_MIN);
  if (playwright) {
    const ipHeader = request.headers.get('x-test-web-call-rate-limit-ip');
    const botHeader = request.headers.get('x-test-web-call-rate-limit-bot');
    if (ipHeader?.trim()) ipPerMin = limitFrom(ipHeader, ipPerMin);
    if (botHeader?.trim()) botPerMin = limitFrom(botHeader, botPerMin);
  }
  return { ipPerMin, botPerMin };
}