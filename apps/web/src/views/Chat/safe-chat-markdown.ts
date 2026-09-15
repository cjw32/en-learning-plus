import { Marked } from 'marked'
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!)
const parser = new Marked({ renderer: {
  html({ text }) { return escapeHtml(text) },
  link({ href, tokens }) {
    const label = this.parser.parseInline(tokens)
    try {
      const url = new URL(href)
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return label
      return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    } catch { return label }
  },
  image({ text }) { return escapeHtml(text) },
} })
export const parseSafeChatMarkdown = (text: string): string => parser.parse(text, { async: false })
