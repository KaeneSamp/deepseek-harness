import { describe, expect, it } from 'vitest'
import { BlockAssembler, ToolCallId, extractThinkingFromChunks, type StreamChunk } from '@deepseek-ai/dsh-llm'

async function collectChunks(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const result: StreamChunk[] = []
  for await (const chunk of iterable) {
    result.push(chunk)
  }
  return result
}

async function* toAsyncStream(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk
  }
}

describe('extractThinkingFromChunks', () => {
  it('passes standard text through cleanly when no thinking tags are present', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hello, ' },
      { type: 'text-delta', index: 0, text: 'world!' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello, world!' } },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'Hello, world!' }])
    expect(assembler.finish).toEqual({ kind: 'stop' })
  })

  it('splits <think>...</think> into a reasoning block followed by a text block', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '<think>Let me formulate the response.</think>Here is your answer.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '<think>Let me formulate the response.</think>Here is your answer.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'reasoning', text: 'Let me formulate the response.' },
      { type: 'text', text: 'Here is your answer.' },
    ])
    // Verify block indexes are 0 and 1
    const starts = processed.filter(c => c.type === 'block-start')
    expect(starts).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-start', index: 1, blockType: 'text' },
    ])
  })

  it('handles leading whitespace before <think> without creating a spurious empty text block', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '\n\n<think>Pondering...</think>Done!' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '\n\n<think>Pondering...</think>Done!' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'reasoning', text: 'Pondering...' },
      { type: 'text', text: 'Done!' },
    ])
  })

  it('preserves genuine text that precedes <think>', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Initial comment.\n<think>Thinking about part 2</think>Conclusion.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Initial comment.\n<think>Thinking about part 2</think>Conclusion.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'text', text: 'Initial comment.\n' },
      { type: 'reasoning', text: 'Thinking about part 2' },
      { type: 'text', text: 'Conclusion.' },
    ])
  })

  it('handles fragmented tags split across multiple TCP chunk boundaries', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Prefix <th' },
      { type: 'text-delta', index: 0, text: 'ink>Deep thought in prog' },
      { type: 'text-delta', index: 0, text: 'ress.</th' },
      { type: 'text-delta', index: 0, text: 'ink>Final ' },
      { type: 'text-delta', index: 0, text: 'result.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Prefix <think>Deep thought in progress.</think>Final result.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'text', text: 'Prefix ' },
      { type: 'reasoning', text: 'Deep thought in progress.' },
      { type: 'text', text: 'Final result.' },
    ])
  })

  it('does not confuse math comparisons or HTML tags like <br> with thinking tags', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'if (a < b && x < 10) { return true }<br/>' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'if (a < b && x < 10) { return true }<br/>' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'text', text: 'if (a < b && x < 10) { return true }<br/>' },
    ])
  })

  it('gracefully closes reasoning block if stream ends before </think>', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '<think>Unfinished thought...' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'reasoning', text: 'Unfinished thought...' },
    ])
    expect(assembler.finish).toEqual({ kind: 'max-tokens' })
  })

  it('supports <thought>...</thought> tag variant', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '<thought>Internal monologue</thought>Action taken.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '<thought>Internal monologue</thought>Action taken.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'reasoning', text: 'Internal monologue' },
      { type: 'text', text: 'Action taken.' },
    ])
  })

  it('remaps subsequent tool calls to valid sequential block indexes', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '<think>I should run ls.</think>' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '<think>I should run ls.</think>' } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 1, id: ToolCallId('call-1'), name: 'bash', argumentsDelta: '{"cmd":"ls"}' },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: ToolCallId('call-1'), name: 'bash', arguments: '{"cmd":"ls"}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'reasoning', text: 'I should run ls.' },
      { type: 'tool-call', id: ToolCallId('call-1'), name: 'bash', arguments: '{"cmd":"ls"}' },
    ])
    // Reasoning was index 0, tool-call was index 1
    const starts = processed.filter(c => c.type === 'block-start')
    expect(starts).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
    ])
  })

  it('handles prefilled reasoning ending in </think> without an opening tag', async () => {
    const rawChunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Thinking started implicitly by system prompt.</think>Now the actual reply.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Thinking started implicitly by system prompt.</think>Now the actual reply.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]

    const processed = await collectChunks(extractThinkingFromChunks(toAsyncStream(rawChunks)))
    const assembler = new BlockAssembler()
    for (const chunk of processed) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([
      { type: 'reasoning', text: 'Thinking started implicitly by system prompt.' },
      { type: 'text', text: 'Now the actual reply.' },
    ])
  })
})
