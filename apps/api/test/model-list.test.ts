import { formatModelList, listProviderModels } from '../src/models/model-list';

const baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';

describe('listProviderModels', () => {
  it('reads ids from the provider’s OpenAI-compatible model list', async () => {
    let calledUrl = '';
    let calledInit: RequestInit | undefined;
    const ids = await listProviderModels({
      baseUrl,
      apiKey: 'test-only-gemini-key',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calledUrl = String(url);
        calledInit = init;
        return new Response(
          JSON.stringify({
            data: [
              { id: 'gemini-3.8-flash' },
              { id: ' gemini-3.1-pro-preview ' },
              { object: 'model' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch,
    });

    expect(calledUrl).toBe(`${baseUrl}/models`);
    expect((calledInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-only-gemini-key',
    );
    expect(ids).toEqual(['gemini-3.8-flash', 'gemini-3.1-pro-preview']);
  });

  it('returns null instead of throwing when the endpoint, key, or answer is unusable', async () => {
    const missing = (async () =>
      new Response('not found', { status: 404 })) as typeof fetch;
    const offline = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    const empty = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
      })) as typeof fetch;

    expect(
      await listProviderModels({ baseUrl, apiKey: 'k', fetchImpl: missing }),
    ).toBeNull();
    expect(
      await listProviderModels({ baseUrl, apiKey: 'k', fetchImpl: offline }),
    ).toBeNull();
    expect(await listProviderModels({ baseUrl, apiKey: 'k', fetchImpl: empty })).toBeNull();
    expect(
      await listProviderModels({ baseUrl: 'not a url', apiKey: 'k', fetchImpl: missing }),
    ).toBeNull();
    expect(
      await listProviderModels({ baseUrl, apiKey: '', fetchImpl: missing }),
    ).toBeNull();
  });
});

describe('formatModelList', () => {
  it('keeps ids a chat completion can run on', () => {
    expect(
      formatModelList([
        'gemini-3.8-flash',
        'gemini-3.8-flash-tts',
        'gemini-3.1-flash-image',
        'gemini-3.1-pro-preview',
        'gemini-embedding-2',
      ]),
    ).toBe('gemini-3.1-pro-preview, gemini-3.8-flash');
  });

  it('counts what it leaves out instead of printing a wall of ids', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `gemini-3.${index}-flash`);
    expect(formatModelList(ids, 3)).toBe(
      'gemini-3.0-flash, gemini-3.1-flash, gemini-3.10-flash (+17 more)',
    );
  });

  it('falls back to the unfiltered list when every id looks non-chat', () => {
    // A wrong key still has to be able to say what it can see rather than nothing.
    expect(formatModelList(['gemini-2.5-flash-preview-tts'])).toBe(
      'gemini-2.5-flash-preview-tts',
    );
  });

  it('keeps provider-controlled ids from forging or flooding a log line', () => {
    const long = 'x'.repeat(200);
    expect(formatModelList([`gemini-3.8-flash\nWARN forged`, long])).toBe(
      `gemini-3.8-flashWARN forged, ${'x'.repeat(64)}`,
    );
  });
});
