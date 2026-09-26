import {
  openAiRequestBody,
  openAiToolsPayload,
  parseOpenAiMessage,
} from '../src/models/openai';

describe('openAiToolsPayload', () => {
  it('translates the desk catalog into callable tools', () => {
    const payload = openAiToolsPayload([
      {
        name: 'trip.outline',
        description: 'Build a day-by-day outline from a destination and dates.',
        parameters: {
          type: 'object',
          properties: { destination: { type: 'string' } },
          required: ['destination'],
          additionalProperties: false,
        },
      },
    ]);

    expect(payload).toEqual([
      {
        type: 'function',
        function: {
          name: 'trip.outline',
          description: 'Build a day-by-day outline from a destination and dates.',
          parameters: {
            type: 'object',
            properties: { destination: { type: 'string' } },
            required: ['destination'],
            additionalProperties: false,
          },
        },
      },
    ]);
  });

  it('omits the field entirely when no tools are offered', () => {
    expect(openAiToolsPayload(undefined)).toBeUndefined();
    expect(openAiToolsPayload([])).toBeUndefined();
  });
});

describe('openAiRequestBody', () => {
  it('sends tools and tool_choice only on the tool pass', () => {
    const withTools = openAiRequestBody({
      model: 'gpt-test',
      system: 'System.',
      history: [{ role: 'user', content: 'Earlier.' }],
      user: 'Plan Lisbon',
      tools: [
        {
          name: 'packing.list',
          description: 'Pack a bag.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    });
    expect(withTools.tool_choice).toBe('auto');
    expect(withTools.tools).toHaveLength(1);
    expect(withTools.messages).toEqual([
      { role: 'system', content: 'System.' },
      { role: 'user', content: 'Earlier.' },
      { role: 'user', content: 'Plan Lisbon' },
    ]);

    const narrate = openAiRequestBody({
      model: 'gpt-test',
      system: 'System.',
      history: [],
      user: 'Plan Lisbon',
    });
    expect(narrate).not.toHaveProperty('tools');
    expect(narrate).not.toHaveProperty('tool_choice');
  });
});

describe('parseOpenAiMessage', () => {
  it('reads text-only replies', () => {
    expect(parseOpenAiMessage({ choices: [{ message: { content: 'Hello.' } }] })).toEqual({
      text: 'Hello.',
      toolCalls: [],
    });
  });

  it('reads tool calls, including a reply with no content', () => {
    const parsed = parseOpenAiMessage({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'trip.outline', arguments: '{"destination":"Lisbon"}' },
              },
            ],
          },
        },
      ],
    });
    expect(parsed.text).toBe('');
    expect(parsed.toolCalls).toEqual([
      {
        id: 'call_abc',
        name: 'trip.outline',
        arguments: '{"destination":"Lisbon"}',
      },
    ]);
  });

  it('ignores a malformed tool call instead of throwing', () => {
    const parsed = parseOpenAiMessage({
      choices: [{ message: { content: 'ok', tool_calls: [null, {}, { function: {} }] } }],
    });
    expect(parsed.text).toBe('ok');
    expect(parsed.toolCalls).toEqual([]);
  });

  it('survives an empty or unexpected body', () => {
    expect(parseOpenAiMessage({})).toEqual({ text: '', toolCalls: [] });
    expect(parseOpenAiMessage(null)).toEqual({ text: '', toolCalls: [] });
    expect(parseOpenAiMessage({ choices: [] })).toEqual({ text: '', toolCalls: [] });
  });
});
