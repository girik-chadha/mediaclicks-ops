import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MODEL_REACHABLE, MODEL_TOOL_DEFS, modelAvailable } from '@/lib/assistant/model-tools'
import { TOOLS } from '@/lib/assistant/tools'

/**
 * The model fallback is a widening of *breadth*, not of *reach* (ADR 0007).
 *
 * These pin the two ways that claim could quietly stop being true: the model
 * being offered a tool the tool layer does not guard, and the model being
 * consulted on a phrasing the grammar already handles for free.
 */

const KEY = 'GROQ_API_KEY'
let saved: string | undefined

beforeEach(() => {
  saved = process.env[KEY]
})

afterEach(() => {
  if (saved === undefined) delete process.env[KEY]
  else process.env[KEY] = saved
})

describe('modelAvailable', () => {
  it('is false with no key, so the build behaves exactly as the grammar-only one did', () => {
    delete process.env[KEY]
    expect(modelAvailable()).toBe(false)
  })

  it('is false for an empty key, not just an absent one', () => {
    process.env[KEY] = ''
    expect(modelAvailable()).toBe(false)
  })

  it('is true once a key is set', () => {
    process.env[KEY] = 'gsk_test'
    expect(modelAvailable()).toBe(true)
  })
})

describe('the tools offered to the model', () => {
  const offered = MODEL_TOOL_DEFS.map((t) => t.function.name)

  /**
   * The load-bearing one. Every tool the model can call has to be a tool
   * `runTool` knows about, because `runTool` is where the permission check
   * lives. A name that does not appear in TOOLS would be rejected at runtime
   * — but as a confusing "there is no tool called X" rather than as a red
   * build, and the model would waste turns retrying it.
   */
  it('are all tools the tool layer knows about', () => {
    const known = new Set(TOOLS.map((t) => t.name))
    for (const name of offered) {
      expect(known.has(name as (typeof TOOLS)[number]['name'])).toBe(true)
    }
  })

  /**
   * request_approval is built by the planner from a *refused* write, never
   * called directly — runTool rejects it by name. Offering it to the model
   * would be offering a way to file an approval request for a change nobody
   * checked the permission on.
   */
  it('do not include request_approval', () => {
    expect(offered).not.toContain('request_approval')
  })

  it('cover every tool the grammar planner can reach, so the model is not narrower', () => {
    expect(new Set(offered)).toEqual(new Set(MODEL_REACHABLE))
  })

  it('declare a parameter schema for every tool, so arguments cannot arrive unshaped', () => {
    for (const def of MODEL_TOOL_DEFS) {
      expect(def.type).toBe('function')
      expect(def.function.parameters.type).toBe('object')
      expect(typeof def.function.description).toBe('string')
      expect(def.function.description.length).toBeGreaterThan(10)
    }
  })

  /**
   * The write tools' descriptions are the only thing stopping the model from
   * reporting a staged change as done in the sentence above the card. The
   * tool result says so too, but by then it has already decided what to say.
   */
  it('tell the model plainly that write tools do not take effect', () => {
    const writes = new Set(
      TOOLS.filter((t) => t.effect === 'write' && t.name !== 'request_approval').map((t) => t.name),
    )
    for (const def of MODEL_TOOL_DEFS) {
      if (!writes.has(def.function.name as never)) continue
      expect(def.function.description.toLowerCase()).toMatch(/stages|does not/)
    }
  })
})
