// Standard runtime error logging fallback
export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  console.error('[Error Captured]', error, context);
}
