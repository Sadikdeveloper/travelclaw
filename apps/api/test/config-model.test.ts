import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { googleOpenAiBaseUrl, loadConfig, loadEnvFiles } from '../src/config';

describe('model provider configuration', () => {
  it('makes a bare Gemini key usable with the canonical Flash model', () => {
    const config = loadConfig({
      GEMINI_API_KEY: 'test-only-gemini-key',
      TRAVELCLAW_MODEL_PROVIDER: 'google',
      GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
    });

    expect(config.modelName).toBe('gemini-2.5-flash');
    expect(config.googleApiKey).toBe('test-only-gemini-key');
    expect(config.googleBaseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
  });

  it('normalizes the common Flash alias instead of sending an unknown model id', () => {
    const config = loadConfig({
      TRAVELCLAW_MODEL_PROVIDER: 'google',
      TRAVELCLAW_MODEL_NAME: 'gemini-flash',
      TRAVELCLAW_MODELS: 'gemini flash,gemini-2.5-pro',
      TRAVELCLAW_GOOGLE_API_KEY: 'test-only-gemini-key',
    });

    expect(config.modelName).toBe('gemini-2.5-flash');
    expect(config.modelNames).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('does not duplicate the OpenAI chat path for a proxy URL', () => {
    expect(
      googleOpenAiBaseUrl(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions/',
      ),
    ).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });

  it('uses a later value in the same env file, so example defaults can be replaced', () => {
    const directory = mkdtempSync(join(tmpdir(), 'travelclaw-config-'));
    const key = `TRAVELCLAW_CONFIG_TEST_${Date.now()}`;
    try {
      writeFileSync(join(directory, '.env'), `${key}=mock\n${key}=google\n`);
      delete process.env[key];
      loadEnvFiles(directory);
      expect(process.env[key]).toBe('google');
    } finally {
      delete process.env[key];
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
