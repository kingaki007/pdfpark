"""Render Markdown without raw HTML or external image/resource loading."""
import html
from markdown_it import MarkdownIt

CSS = """
body { font-family: sans-serif; font-size: 11pt; line-height: 1.45; }
h1 { font-size: 24pt; } h2 { font-size: 19pt; } h3 { font-size: 15pt; }
h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
p { margin: 0 0 9pt; }
pre { font-family: monospace; font-size: 9pt; white-space: pre-wrap; background-color: #f1f3f5; padding: 8pt; }
code { font-family: monospace; }
table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
th, td { border: 1px solid #ccd1d7; padding: 5pt; }
th { background-color: #eef1f5; }
blockquote { margin-left: 14pt; color: #555555; }
a { color: #185be8; }
"""


def render_markdown(text):
    parser = MarkdownIt('commonmark', {'html': False}).enable('table')
    # Never resolve remote resources or paths from an uploaded document.
    def image(tokens, index, options, env):
        token = tokens[index]
        label = parser.renderer.renderInlineAsText(token.children or [], options, env)
        return '<span>[Image: ' + html.escape(label or 'image') + ']</span>'
    parser.renderer.rules['image'] = image
    return parser.render(text)

