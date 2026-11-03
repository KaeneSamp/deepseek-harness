/**
 * Semantic stagnation detector for monitoring reasoning progression in autonomous agent turns.
 * Uses N-gram Jaccard divergence to detect repetitive thinking loops without imposing rigid step caps.
 *
 * @module dsh-agent-loop/stagnation
 */

export interface StagnationDetectorOptions {
  /** Maximum consecutive pure-reasoning steps permitted before forced completion. Defaults to 15. */
  maxPureReasoningSteps?: number
  /** Minimum novelty threshold (1 - Jaccard similarity) between consecutive thoughts. Defaults to 0.15. */
  minDivergenceThreshold?: number
}

/**
 * Tracks consecutive reasoning thoughts and detects loops or cognitive stagnation.
 */
export class SemanticStagnationDetector {
  private recentThoughts: string[] = []
  private consecutiveReasoningSteps = 0
  private readonly maxPureReasoningSteps: number
  private readonly minDivergenceThreshold: number

  constructor(options?: StagnationDetectorOptions) {
    this.maxPureReasoningSteps = options?.maxPureReasoningSteps ?? 15
    this.minDivergenceThreshold = options?.minDivergenceThreshold ?? 0.15
  }

  /**
   * Resets the stagnation state when substantive progress (tool call or user-facing reply) occurs.
   */
  reset(): void {
    this.recentThoughts = []
    this.consecutiveReasoningSteps = 0
  }

  /**
   * Records a reasoning step and verifies whether thought progression is healthy.
   * @param thought - concatenated reasoning text produced in this step.
   * @returns true if thought progression is healthy and novel; false if stagnating in a repetitive loop.
   */
  recordAndCheckProgress(thought: string): boolean {
    this.consecutiveReasoningSteps++
    if (this.consecutiveReasoningSteps > this.maxPureReasoningSteps) {
      return false
    }

    const normalized = thought
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (this.recentThoughts.length > 0) {
      const prevThought = this.recentThoughts[this.recentThoughts.length - 1]
      if (prevThought !== undefined) {
        const similarity = this.computeJaccardSimilarity(normalized, prevThought)
        const divergence = 1.0 - similarity

        // Repetitive loop: similarity >= 85% (divergence < 0.15) between consecutive thoughts
        if (divergence < this.minDivergenceThreshold) {
          return false
        }
      }
    }


    this.recentThoughts.push(normalized)
    if (this.recentThoughts.length > 5) {
      this.recentThoughts.shift()
    }
    return true
  }

  /**
   * Computes Jaccard similarity over word 1-grams and 2-grams.
   */
  private computeJaccardSimilarity(a: string, b: string): number {
    if (a === b) return 1.0
    if (a.length === 0 || b.length === 0) return 0.0

    const gramsA = this.getGrams(a)
    const gramsB = this.getGrams(b)
    if (gramsA.size === 0 || gramsB.size === 0) return 0.0

    let intersectionSize = 0
    for (const gram of gramsA) {
      if (gramsB.has(gram)) intersectionSize++
    }

    const unionSize = gramsA.size + gramsB.size - intersectionSize
    return unionSize === 0 ? 0.0 : intersectionSize / unionSize
  }

  private getGrams(text: string): Set<string> {
    const tokens = text.split(/\s+/).filter(t => t.length > 0)
    const grams = new Set<string>()
    for (const token of tokens) {
      grams.add(token)
    }
    for (let i = 0; i < tokens.length - 1; i++) {
      grams.add(`${tokens[i]} ${tokens[i + 1]}`)
    }
    return grams
  }
}
