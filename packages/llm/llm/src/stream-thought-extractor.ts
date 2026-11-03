import type { ContentBlockType, StreamChunk, ToolCallBlock } from './types.ts'

const OPEN_TAG_RE = /<(?:think(?:ing)?|thought)>/i
const CLOSE_TAG_RE = /<\/(?:think(?:ing)?|thought)>/i


interface ActiveBlockState {
  index: number
  type: ContentBlockType
  text: string
  toolCall?: ToolCallBlock
}


/**
 * Checks if the buffer ends with a potential opening or closing thinking tag prefix
 * (e.g. "<", "</", "</th", "<thi", etc.).
 * Returns the index where the partial tag starts, or -1 if no prefix is found.
 */
function findPartialTagStart(buffer: string): number {
  const lastOpenAngle = buffer.lastIndexOf('<')
  if (lastOpenAngle === -1) return -1

  const tail = buffer.slice(lastOpenAngle)
  if (tail.includes('>')) return -1
  if (tail.length > 25) return -1

  if (/^<\/?\s*[a-z]*\s*$/i.test(tail)) {
    const norm = tail.toLowerCase().replace(/\s+/g, '')
    if (
      '<think'.startsWith(norm) ||
      '</think'.startsWith(norm) ||
      '<thought'.startsWith(norm) ||
      '</thought'.startsWith(norm)
    ) {
      return lastOpenAngle
    }
  }

  return -1
}

/**
 * Transforms an async stream of `StreamChunk` by extracting in-band `<think>...</think>`
 * tags into separate canonical `reasoning` blocks while preserving clean `text` blocks.
 *
 * Emitted block indexes are sequentially mapped from 0 so that downstream consumers
 * (BlockAssembler, UI, etc.) receive monotonic, valid block indexes.
 */
export class ThoughtStreamTransformer {
  private mode: 'TEXT' | 'REASONING' = 'TEXT'
  private nextIndex = 0
  private activeBlock: ActiveBlockState | null = null
  private readonly emittedBlocks: Array<{ type: ContentBlockType }> = []
  private buffer = ''
  private readonly mappedIndexes = new Map<number, number>()

  private *startBlock(type: ContentBlockType, toolCall?: ToolCallBlock): Generator<StreamChunk> {

    if (this.activeBlock) {
      yield* this.closeActiveBlock()
    }
    const index = this.nextIndex++
    this.activeBlock = { index, type, text: '', ...toolCall ? { toolCall } : {} }
    this.emittedBlocks.push({ type })
    yield { type: 'block-start', index, blockType: type }
  }

  private *closeActiveBlock(): Generator<StreamChunk> {
    if (!this.activeBlock) return
    const { index, type, text, toolCall } = this.activeBlock
    this.activeBlock = null
    if (type === 'text') {
      yield { type: 'block-end', index, block: { type: 'text', text } }
    } else if (type === 'reasoning') {
      const cleanedText = text.replace(/^\r?\n/, '').replace(/\r?\n$/, '')
      yield { type: 'block-end', index, block: { type: 'reasoning', text: cleanedText } }
    } else if (toolCall) {
      yield { type: 'block-end', index, block: toolCall }
    }
  }

  private *processText(incomingText: string, isEof = false): Generator<StreamChunk> {
    this.buffer += incomingText

    while (this.buffer.length > 0) {
      if (this.mode === 'TEXT') {
        const openMatch = OPEN_TAG_RE.exec(this.buffer)
        if (openMatch) {
          const before = this.buffer.slice(0, openMatch.index)
          if (before.trim().length > 0 || (this.activeBlock?.type === 'text' && before.length > 0)) {
            if (this.activeBlock?.type !== 'text') {
              yield* this.startBlock('text')
            }
            if (this.activeBlock) {
              this.activeBlock.text += before
              yield { type: 'text-delta', index: this.activeBlock.index, text: before }
            }
          }
          yield* this.closeActiveBlock()
          this.mode = 'REASONING'
          yield* this.startBlock('reasoning')
          this.buffer = this.buffer.slice(openMatch.index + openMatch[0].length)
          continue
        }

        // Prefill / unclosed start case: model emitted </think> while in TEXT mode
        const closeMatch = CLOSE_TAG_RE.exec(this.buffer)
        if (closeMatch) {
          const before = this.buffer.slice(0, closeMatch.index)
          if (before.length > 0) {
            yield* this.startBlock('reasoning')
            if (this.activeBlock) {
              this.activeBlock.text += before
              yield { type: 'reasoning-delta', index: this.activeBlock.index, text: before }
            }
            yield* this.closeActiveBlock()
          } else if (this.activeBlock?.type === 'text') {
            this.activeBlock.type = 'reasoning'
            yield* this.closeActiveBlock()
          }
          this.buffer = this.buffer.slice(closeMatch.index + closeMatch[0].length)
          this.mode = 'TEXT'
          continue
        }

        if (!isEof) {
          const partialStart = findPartialTagStart(this.buffer)
          if (partialStart !== -1) {
            const emitText = this.buffer.slice(0, partialStart)
            this.buffer = this.buffer.slice(partialStart)
            if (emitText.length > 0) {
              if (this.activeBlock?.type !== 'text') {
                yield* this.startBlock('text')
              }
              if (this.activeBlock) {
                this.activeBlock.text += emitText
                yield { type: 'text-delta', index: this.activeBlock.index, text: emitText }
              }
            }
            break
          } else {
            if (this.activeBlock?.type !== 'text') {
              yield* this.startBlock('text')
            }
            if (this.activeBlock) {
              this.activeBlock.text += this.buffer
              yield { type: 'text-delta', index: this.activeBlock.index, text: this.buffer }
            }
            this.buffer = ''
            break
          }
        } else {
          if (this.buffer.length > 0) {
            if (this.activeBlock?.type !== 'text') {
              yield* this.startBlock('text')
            }
            if (this.activeBlock) {
              this.activeBlock.text += this.buffer
              yield { type: 'text-delta', index: this.activeBlock.index, text: this.buffer }
            }
            this.buffer = ''
          }
          break
        }
      } else {
        // mode === 'REASONING'
        const closeMatch = CLOSE_TAG_RE.exec(this.buffer)
        if (closeMatch) {
          const before = this.buffer.slice(0, closeMatch.index)
          if (before.length > 0) {
            if (this.activeBlock?.type !== 'reasoning') {
              yield* this.startBlock('reasoning')
            }
            if (this.activeBlock) {
              this.activeBlock.text += before
              yield { type: 'reasoning-delta', index: this.activeBlock.index, text: before }
            }
          }
          yield* this.closeActiveBlock()
          this.mode = 'TEXT'
          this.buffer = this.buffer.slice(closeMatch.index + closeMatch[0].length)
          continue
        }

        if (!isEof) {
          const partialStart = findPartialTagStart(this.buffer)
          if (partialStart !== -1) {
            const emitText = this.buffer.slice(0, partialStart)
            this.buffer = this.buffer.slice(partialStart)
            if (emitText.length > 0) {
              if (this.activeBlock?.type !== 'reasoning') {
                yield* this.startBlock('reasoning')
              }
              if (this.activeBlock) {
                this.activeBlock.text += emitText
                yield { type: 'reasoning-delta', index: this.activeBlock.index, text: emitText }
              }
            }
            break
          } else {
            if (this.activeBlock?.type !== 'reasoning') {
              yield* this.startBlock('reasoning')
            }
            if (this.activeBlock) {
              this.activeBlock.text += this.buffer
              yield { type: 'reasoning-delta', index: this.activeBlock.index, text: this.buffer }
            }
            this.buffer = ''
            break
          }
        } else {
          if (this.buffer.length > 0) {
            if (this.activeBlock?.type !== 'reasoning') {
              yield* this.startBlock('reasoning')
            }
            if (this.activeBlock) {
              this.activeBlock.text += this.buffer
              yield { type: 'reasoning-delta', index: this.activeBlock.index, text: this.buffer }
            }
            this.buffer = ''
          }
          yield* this.closeActiveBlock()
          break
        }
      }
    }
  }

  async *transform(stream: AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk> {
    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'block-start': {
          if (chunk.blockType === 'text') {
            // Defer block-start until text-delta resolves whether content begins with <think>
          } else if (chunk.blockType === 'reasoning') {
            yield* this.processText('', true)
            yield* this.closeActiveBlock()
            this.mode = 'REASONING'
            yield* this.startBlock('reasoning')
          } else if (chunk.blockType === 'tool-call') {
            yield* this.processText('', true)
            yield* this.closeActiveBlock()
            const mappedIndex = this.nextIndex++
            this.mappedIndexes.set(chunk.index, mappedIndex)
            this.emittedBlocks.push({ type: 'tool-call' })
            yield { type: 'block-start', index: mappedIndex, blockType: 'tool-call' }
          } else {
            yield* this.processText('', true)
            yield* this.closeActiveBlock()
            const mappedIndex = this.nextIndex++
            this.mappedIndexes.set(chunk.index, mappedIndex)
            this.emittedBlocks.push({ type: chunk.blockType as ContentBlockType })
            yield { ...chunk, index: mappedIndex }
          }
          break
        }
        case 'text-delta': {
          yield* this.processText(chunk.text, false)
          break
        }
        case 'reasoning-delta': {
          if (!this.activeBlock || this.activeBlock.type !== 'reasoning') {
            yield* this.processText('', true)
            yield* this.closeActiveBlock()
            this.mode = 'REASONING'
            yield* this.startBlock('reasoning')
          }
          if (this.activeBlock) {
            this.activeBlock.text += chunk.text
            yield { type: 'reasoning-delta', index: this.activeBlock.index, text: chunk.text }
          }
          break
        }
        case 'tool-call-delta': {
          yield* this.processText('', true)
          yield* this.closeActiveBlock()
          const mappedIndex = this.mappedIndexes.get(chunk.index) ?? chunk.index
          yield { ...chunk, index: mappedIndex }
          break
        }
        case 'block-end': {
          if (chunk.block.type === 'text') {
            yield* this.processText('', true)
            yield* this.closeActiveBlock()
          } else if (chunk.block.type === 'reasoning') {
            yield* this.processText('', true)
            yield* this.closeActiveBlock()
            this.mode = 'TEXT'
          } else {
            yield* this.processText('', true)
            yield* this.closeActiveBlock()
            const mappedIndex = this.mappedIndexes.get(chunk.index) ?? chunk.index
            yield { ...chunk, index: mappedIndex }
          }
          break
        }
        case 'usage': {
          yield* this.processText('', true)
          yield* this.closeActiveBlock()
          yield chunk
          break
        }
        case 'finish': {
          yield* this.processText('', true)
          yield* this.closeActiveBlock()

          let replayState = chunk.replayState
          if (replayState?.blocks && this.emittedBlocks.length > 0) {
            const remappedBlocks = this.emittedBlocks.map((b, i) => {
              const original = replayState?.blocks?.[i]
              if (typeof original === 'object' && original !== null) {
                return { ...original, type: b.type }
              }
              return { type: b.type }
            })
            replayState = {
              ...replayState,
              blocks: remappedBlocks,
            }
          }
          yield { ...chunk, ...replayState !== undefined ? { replayState } : {} }
          break
        }
      }
    }

    // Stream ended without a terminal finish chunk: flush any remaining buffer
    yield* this.processText('', true)
    yield* this.closeActiveBlock()
  }
}

/**
 * Wraps an async stream of `StreamChunk` and transforms in-band `<think>...</think>`
 * tags into separate canonical `reasoning` blocks while preserving clean `text` blocks.
 */
export async function* extractThinkingFromChunks(
  stream: AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  const transformer = new ThoughtStreamTransformer()
  yield* transformer.transform(stream)
}
