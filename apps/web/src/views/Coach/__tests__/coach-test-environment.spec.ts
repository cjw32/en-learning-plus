import { describe, expect, it } from 'vitest'

describe('Coach unit-test environment', () => {
  it('provides a browser-like DOM without a production origin', () => {
    expect(document.createElement('section')).toBeInstanceOf(HTMLElement)
    expect(window.location.hostname).not.toMatch(/(?:prod|production)/i)
  })
})
