import { describe, expect, it } from 'vitest'
import { parseSafeChatMarkdown } from '../safe-chat-markdown'
describe('chat markdown', () => {
  it.each(['<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<script>alert(1)</script>',
    '[bad](javascript:alert%281%29)', '[bad](data:text/html,evil)', '[bad](jav&#x61;script:alert%281%29)',
    '![tracking](https://tracker.example/pixel)'])('does not render executable or tracking content: %s', input => {
    const root = document.createElement('div'); root.innerHTML = parseSafeChatMarkdown(input)
    expect(root.querySelector('script,img,svg,iframe,object')).toBeNull()
    for (const node of root.querySelectorAll('*')) {
      expect([...node.attributes].some(attr => attr.name.startsWith('on'))).toBe(false)
    }
    expect(root.querySelector('a')).toBeNull()
  })
  it('preserves ordinary Markdown and safe links', () => {
    const html = parseSafeChatMarkdown('**hello** `code` [source](https://example.com/?q=one&b=two)')
    expect(html).toContain('<strong>hello</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('&amp;b=two')
  })
})
