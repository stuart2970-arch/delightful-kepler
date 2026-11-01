export function voiceLogError(label: string, err: unknown) {
  const value = err as { message?: string; code?: string } | null;
  console.error(label, {
    message: value?.message,
    code: value?.code,
  });
}
