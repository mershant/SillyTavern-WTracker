import { buildOpenAIChatCompletionsUrl, isLocalOpenAIEndpoint, normalizeOpenAIMessageContent } from './openai-compat.js';

describe('buildOpenAIChatCompletionsUrl', () => {
  test('appends chat completions to a /v1 base url', () => {
    expect(buildOpenAIChatCompletionsUrl('http://localhost:1234/v1')).toBe(
      'http://localhost:1234/v1/chat/completions',
    );
  });

  test('keeps an explicit chat completions url unchanged', () => {
    expect(buildOpenAIChatCompletionsUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });
});

describe('isLocalOpenAIEndpoint', () => {
  test('detects local endpoints', () => {
    expect(isLocalOpenAIEndpoint('http://127.0.0.1:1234/v1/chat/completions')).toBe(true);
    expect(isLocalOpenAIEndpoint('http://localhost:1234/v1/chat/completions')).toBe(true);
  });

  test('does not treat cloud endpoints as local', () => {
    expect(isLocalOpenAIEndpoint('https://api.openai.com/v1/chat/completions')).toBe(false);
  });
});

describe('normalizeOpenAIMessageContent', () => {
  test('returns string content unchanged', () => {
    expect(normalizeOpenAIMessageContent('hello')).toBe('hello');
  });

  test('converts undefined to empty string instead of throwing later', () => {
    expect(normalizeOpenAIMessageContent(undefined)).toBe('');
  });

  test('stringifies non-string values safely', () => {
    expect(normalizeOpenAIMessageContent({ a: 1 })).toBe('{"a":1}');
  });
});
