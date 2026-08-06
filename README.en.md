<div align="center">

# MD Plus

### Write, read, edit. All in one window.

The power of Markdown, beyond the marks. Just focus on the content.

English · **[Türkçe](README.md)**

</div>

MD Plus is an offline desktop Markdown app that opens several `.md` files in
tabs. Every tab both reads and writes; formatting sits on the text, and there is
no separate preview.

Everything you write is plain Markdown — nothing of this app's own ever enters
your `.md` file. Your marks and comments are not kept beside the document
either, but in the app's own folder, so opening your file in another editor
shows you nothing but your own text.

---

## Five pillars

### Work in tabs

All your documents in one window, tab by tab, always within reach. Tabs reorder
by drag and save themselves — each save lands in a temporary file and is moved
into place, so a write cut short can never touch your document. Formatting comes
from a **floating palette** that appears on a selection, and from shortcuts:
bold, italic, heading, list, quote, code, callout, image, link.

### Mark and comment

Mark what matters and write a note in the margin. Your notes stay in the margin,
out of your file. What a mark holds is not a position but **the text itself**: if
the file changes underneath it, the mark reattaches; if it cannot, it is not
deleted — it is unresolved. Move the document to another folder and your notes
still find it.

### Transfer between documents

Carry what you select into another document. **Transfer** opens a full layer over
the tabs: source on the left, target on the right. Walk the marks, send the one
you want with **Taşı**. The text lands as a quotation and carries a single `🔗`
citation beside it — click it and you are back at that exact place in the source
(`document.md#heading`, `book.pdf#page=12`).

### PDFs live here too

A PDF opens, is read, marked and commented on; what you select goes into your
`.md` document. It is tidied on the way: line endings join, hyphenated words are
put back together, paragraphs and lists are recognised from how they sit on the
page. A two-column page is read in the right order. Nothing is ever written into
a PDF, and no PDF is converted.

### AI, if you want it

Let it tidy the text or nudge a word. The pen is still yours. The optional layer
works from the document row, the palette and the right-click menu; **the output
comes in the language of the text you are working on**. The jobs: fluent
alternative · continuing paragraph · spelling and punctuation · fact check ·
source suggestion · summary · title · pull quote · translation. The last five are
read-only and can never enter the document.

**Use the subscription you already pay for.** If Claude Code, Antigravity or
Codex is installed, MD Plus runs it directly — no second key to buy, nothing to
pay per token. If they are not installed, they never appear in the list.

The usual providers are here too: Gemini, Claude, OpenAI, OpenRouter, NVIDIA,
Groq, DeepSeek, local **Ollama**, and any OpenAI-compatible service (by entering
its address). Your keys are kept in the operating system's own vault, never in a
settings file. The default is **off**: with no model connected, the app is
exactly its AI-free self.

---

## More

- **Images** — paste from the clipboard or drag them in; they are copied into the
  document's own folder (`thesis.md` → `thesis.images/`) and shown inline. What to
  take along when you share the document is clear from the name.
- **Formulas** — LaTeX written as `$...$`, typeset with KaTeX.
- **PDF and printing** — the document prints to A4; marks and comments never
  reach the output.
- **Find and replace** — `Ctrl+F` / `Ctrl+H`, with correct Turkish case folding.
  The search can run inside your marks, and it works in PDFs too.
- **Embedded document** — opens the contents of an `.md` link in place,
  read-only.
- **External changes** — if your file changed elsewhere, you are told; if you have
  unsaved writing, the choice is yours.
- **Recent documents**, **outline**, mark list, link following and the way back.

## Two languages

The interface is **Turkish and English**. It follows your operating system at
first launch and can be changed in Settings. AI output, independently of the
interface, comes in **the language of the text**.

## Stack

[Tauri 2](https://tauri.app/) (Rust shell) + [Vite](https://vitejs.dev/) +
[CodeMirror 6](https://codemirror.net/) + [pdf.js](https://mozilla.github.io/pdf.js/) +
[KaTeX](https://katex.org/) + [marked](https://marked.js.org/).
Standalone `.exe` ~19 MB.

## Development

```bash
npm install
npm run app        # development (live reload)
npm run app:build  # standalone exe + MSI (src-tauri/target/release/)
npm test           # unit tests
```

## How it was made

This project was written by **vibe coding**: the product idea, the design
decisions, the requirements and the direction are entirely the **repository
owner's (Zafer Kılıç)**; **all of the code was written by an AI** under his
direction. The human decided what and how, the machine wrote the lines.

## Licence

[MIT](LICENSE) © Zafer Kılıç
