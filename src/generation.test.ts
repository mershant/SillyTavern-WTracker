import { buildModeSequence, runWithRetry } from './generation.js';
import { PromptEngineeringMode } from './config.js';

describe('buildModeSequence', () => {
  test('adds JSON fallback after native mode when enabled', () => {
    expect(buildModeSequence(PromptEngineeringMode.NATIVE, true)).toEqual([
      PromptEngineeringMode.NATIVE,
      PromptEngineeringMode.JSON,
    ]);
  });

  test('keeps only native mode when fallback disabled', () => {
    expect(buildModeSequence(PromptEngineeringMode.NATIVE, false)).toEqual([PromptEngineeringMode.NATIVE]);
  });

  test('leaves simple modes unchanged', () => {
    expect(buildModeSequence(PromptEngineeringMode.JSON, true)).toEqual([PromptEngineeringMode.JSON]);
    expect(buildModeSequence(PromptEngineeringMode.XML, true)).toEqual([PromptEngineeringMode.XML]);
  });
});

describe('runWithRetry', () => {
  test('retries the same mode before succeeding', async () => {
    const calls: string[] = [];
    const result = await runWithRetry([PromptEngineeringMode.JSON], 2, async (mode, attempt) => {
      calls.push(`${mode}:${attempt}`);
      if (attempt < 2) {
        throw new Error(`fail-${attempt}`);
      }
      return `${mode}-ok`;
    });

    expect(result).toEqual({
      attempts: 3,
      modeUsed: PromptEngineeringMode.JSON,
      value: 'json-ok',
    });
    expect(calls).toEqual(['json:0', 'json:1', 'json:2']);
  });

  test('falls back to later mode after retries are exhausted', async () => {
    const calls: string[] = [];
    const result = await runWithRetry(
      [PromptEngineeringMode.NATIVE, PromptEngineeringMode.JSON],
      1,
      async (mode, attempt) => {
        calls.push(`${mode}:${attempt}`);
        if (mode === PromptEngineeringMode.NATIVE) {
          throw new Error(`native-${attempt}`);
        }
        return 'json-ok';
      },
    );

    expect(result).toEqual({
      attempts: 3,
      modeUsed: PromptEngineeringMode.JSON,
      value: 'json-ok',
    });
    expect(calls).toEqual(['native:0', 'native:1', 'json:0']);
  });

  test('throws the last error after all modes and retries fail', async () => {
    await expect(
      runWithRetry([PromptEngineeringMode.NATIVE, PromptEngineeringMode.JSON], 1, async (mode, attempt) => {
        throw new Error(`${mode}-${attempt}`);
      }),
    ).rejects.toThrow('json-1');
  });

  test('does not retry after abort errors', async () => {
    const calls: string[] = [];
    await expect(
      runWithRetry([PromptEngineeringMode.NATIVE, PromptEngineeringMode.JSON], 3, async (mode, attempt) => {
        calls.push(`${mode}:${attempt}`);
        const error = new DOMException('Request aborted by user', 'AbortError');
        throw error;
      }),
    ).rejects.toThrow('Request aborted by user');

    expect(calls).toEqual(['native:0']);
  });
});
