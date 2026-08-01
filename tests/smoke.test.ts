import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

/* Placeholder proving the harness, the `@/` alias and TS strict all work.
   Deleted at Stop 3 when the permission matrix arrives. */
describe('test harness', () => {
  it('resolves the @/ alias', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c')
  })

  it('lets later Tailwind utilities win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})
