import { Marked, type Tokens } from 'marked';

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

/** True for relative links and for `https:` and `mailto:` ones; parsed the way a browser reads an `href`. */
function safeHref(href: string): boolean {
  try {
    return ['https:', 'mailto:'].includes(new URL(href, 'https://ember.invalid/').protocol);
  } catch {
    return false;
  }
}

const legalMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!safeHref(href)) return text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`;
    },
    table({ header, rows }) {
      const labels = header.map((cell) => escapeHtml(cell.text));
      const head = header.map((cell) => `<th>${this.parser.parseInline(cell.tokens)}</th>`).join('');
      const body = rows
        .map(
          (row) =>
            `<tr>${row.map((cell, i) => `<td data-label="${labels[i] ?? ''}">${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`,
        )
        .join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>\n`;
    },
  },
});

/** A legal document rendered for `dangerouslySetInnerHTML`. */
export interface LegalDocument {
  /** The text of the document's leading `#` heading, or null when it has none. */
  heading: string | null;
  html: string;
}

/**
 * Renders a legal markdown text. Raw HTML in the source comes out as escaped text, and links other than relative,
 * `https:` and `mailto:` ones render as their plain text, so the output is safe to inject. A leading `#` heading is
 * taken out and returned as `heading`.
 */
export function renderLegal(markdown: string): LegalDocument {
  const tokens = legalMarked.lexer(markdown);
  const first = tokens[0];
  let heading: string | null = null;
  if (first?.type === 'heading' && (first as Tokens.Heading).depth === 1) {
    heading = (first as Tokens.Heading).text;
    tokens.shift();
  }
  return { heading, html: legalMarked.parser(tokens) };
}
