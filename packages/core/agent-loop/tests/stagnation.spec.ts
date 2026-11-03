import { describe, expect, it } from 'vitest'
import { SemanticStagnationDetector } from '../src/stagnation.ts'

describe('SemanticStagnationDetector', () => {
  it('permits healthy continuous reasoning progression with novel thoughts', () => {
    const detector = new SemanticStagnationDetector({ maxPureReasoningSteps: 10, minDivergenceThreshold: 0.15 })

    expect(detector.recordAndCheckProgress('Analyzing the project structure and searching for entry points.')).toBe(true)
    expect(detector.recordAndCheckProgress('Now inspecting packages/core/agent-loop/src/agent.ts for step decision logic.')).toBe(true)
    expect(detector.recordAndCheckProgress('Found lines 586-587 where toolCalls length was checked unconditionally.')).toBe(true)
    expect(detector.recordAndCheckProgress('Designing the state machine to split streaming thoughts into separate blocks.')).toBe(true)
    expect(detector.recordAndCheckProgress('Preparing to call tool to apply the modification to agent.ts.')).toBe(true)
  })

  it('detects stagnation and repetitive loops when thoughts repeat without semantic novelty', () => {
    const detector = new SemanticStagnationDetector({ maxPureReasoningSteps: 10, minDivergenceThreshold: 0.15 })

    expect(detector.recordAndCheckProgress('I need to read the file packages/core/agent-loop/src/agent.ts to inspect the step function.')).toBe(true)
    // Repeated thought with minor lexical variation (divergence < 0.15)
    const isHealthy = detector.recordAndCheckProgress('I need to read the file packages/core/agent-loop/src/agent.ts to inspect the step function now.')
    expect(isHealthy).toBe(false)
  })

  it('enforces maximum pure-reasoning steps ceiling as extreme safety fallback', () => {
    const detector = new SemanticStagnationDetector({ maxPureReasoningSteps: 3, minDivergenceThreshold: 0.15 })

    expect(detector.recordAndCheckProgress('Completely novel thought number one discussing algorithms.')).toBe(true)
    expect(detector.recordAndCheckProgress('Completely novel thought number two evaluating database queries.')).toBe(true)
    expect(detector.recordAndCheckProgress('Completely novel thought number three designing user interfaces.')).toBe(true)
    // 4th step exceeds maxPureReasoningSteps: 3
    expect(detector.recordAndCheckProgress('Completely novel thought number four deploying cloud infrastructure.')).toBe(false)
  })

  it('resets state when progress occurs so subsequent steps start fresh', () => {
    const detector = new SemanticStagnationDetector({ maxPureReasoningSteps: 2, minDivergenceThreshold: 0.15 })

    expect(detector.recordAndCheckProgress('Thought 1')).toBe(true)
    expect(detector.recordAndCheckProgress('Thought 2')).toBe(true)
    // Ceil reached
    expect(detector.recordAndCheckProgress('Thought 3')).toBe(false)

    // Tool executed or substantive reply delivered
    detector.reset()

    // Counter and history are reset
    expect(detector.recordAndCheckProgress('Fresh thought after tool execution.')).toBe(true)
    expect(detector.recordAndCheckProgress('Second fresh thought after tool execution.')).toBe(true)
  })
})
