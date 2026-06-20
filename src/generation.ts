import { PromptEngineeringMode } from './config.js';

export type GenerationMode = PromptEngineeringMode;

export function buildModeSequence(
  primaryMode: GenerationMode,
  fallbackNativeToJson: boolean,
): GenerationMode[] {
  if (primaryMode === PromptEngineeringMode.NATIVE && fallbackNativeToJson) {
    return [PromptEngineeringMode.NATIVE, PromptEngineeringMode.JSON];
  }

  return [primaryMode];
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function isNonRetryableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as any).retryable === false;
}

export async function runWithRetry<T>(
  modes: GenerationMode[],
  retryCount: number,
  runner: (mode: GenerationMode, attempt: number) => Promise<T>,
): Promise<{ value: T; modeUsed: GenerationMode; attempts: number }> {
  const safeRetryCount = Math.max(0, retryCount || 0);
  let attempts = 0;
  let lastError: unknown;

  for (const mode of modes) {
    for (let attempt = 0; attempt <= safeRetryCount; attempt++) {
      attempts += 1;
      try {
        const value = await runner(mode, attempt);
        return { value, modeUsed: mode, attempts };
      } catch (error) {
        lastError = error;
        if (isAbortError(error) || isNonRetryableError(error)) {
          throw error;
        }
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Generation failed'));
}
