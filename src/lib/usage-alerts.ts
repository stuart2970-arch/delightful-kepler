/** In-app dashboard usage alerts. 80% is the warning. 100% is the limit. Email is out of scope. */
export const USAGE_ALERT_WARNING_PERCENT = 80;
export const USAGE_ALERT_LIMIT_PERCENT = 100;

export type UsageAlertLevel = 'none' | 'warning' | 'limit';

export function usageAlertLevel(percentUsed: number): UsageAlertLevel {
  if (!Number.isFinite(percentUsed)) return 'none';
  if (percentUsed >= USAGE_ALERT_LIMIT_PERCENT) return 'limit';
  if (percentUsed >= USAGE_ALERT_WARNING_PERCENT) return 'warning';
  return 'none';
}
