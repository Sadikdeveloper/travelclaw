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

    // Flash, not a 2.5 id: a key created now gets a 404 for the previous generation.
    expect(config.modelName).toBe('gemini-3.8-flash');
    expect(config.googleApiKey).toBe('test-only-gemini-key');
    expect(config.googleBaseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai',
    );
  });

  it('normalizes the common Gemini aliases instead of sending an unknown model id', () => {
    const config = loadConfig({
      TRAVELCLAW_MODEL_PROVIDER: 'google',
      TRAVELCLAW_MODEL_NAME: 'gemini flash',
      TRAVELCLAW_MODELS: 'gemini-pro,gemini-3.5-flash',
      TRAVELCLAW_GOOGLE_API_KEY: 'test-only-gemini-key',
    });

    expect(config.modelName).toBe('gemini-3.8-flash');
    expect(config.modelNames).toEqual(['gemini-3.1-pro-preview', 'gemini-3.5-flash']);
  });

  it('leaves an explicit model id alone, legacy or not', () => {
    // An older key still answers on a 2.5 id, so the desk reports the id it was given;
    // the boot warning, not a silent rewrite, is what tells the operator it is legacy.
    const config = loadConfig({
      TRAVELCLAW_MODEL_PROVIDER: 'google',
      TRAVELCLAW_MODEL_NAME: 'gemini-2.5-pro',
      TRAVELCLAW_GOOGLE_API_KEY: 'test-only-gemini-key',
    });

    expect(config.modelName).toBe('gemini-2.5-pro');
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
