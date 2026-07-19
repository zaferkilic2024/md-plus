<div align="center">

# MD Plus

### Write, read, edit. All in one window.

The power of Markdown, beyond the marks. Just focus on the content.

English · **[Türkçe](README.md)**

</div>

MD Plus is a desktop Markdown app that opens several `.md` files in tabs. Every
tab both reads and writes; the writing surface is **in-place formatting**: type
bold and it looks bold, and the raw marks appear only on the line holding the
cursor. There is no separate preview mode, because there is no need for one.

---

## Four pillars

### Work in tabs

All your documents in one window, tab by tab, always within reach. Tabs reorder
by drag, save themselves, and keep a `.bak` backup on every save. Formatting
comes from a **floating palette** that appears on a selection, and from
shortcuts: bold, italic, heading, list, quote, code, callout, image, link.

### Transfer between documents

Move a text's standout passages into another document in seconds. The
**Transfer** screen opens a full layer over the tabs: source on the left, target
on the right. Travel between the marks (`‹ n/m ›`) and send the piece you chose
into the target with the **Move** button beside the mark. Send the same piece as
many times as you like.

### Mark and comment

Highlight what matters and take notes. The document stays wholly yours. Marks and
comments never disturb the document's flow — they align to a badge in the right
margin — and if the source file changes from the outside, a mark tries to
re-anchor itself.

### AI assistance

Let it tidy the text and spark words. The pen is still yours. The optional AI
layer runs from the document menu and the palette, and **the output comes back in
the language of the text you are working on** — select an English paragraph and
you get English, a Turkish one and you get Turkish. The jobs:

- **Fluent alternative** — the same content, more fluently (numbers, names and
  formulas are preserved).
- **Continuation paragraph** — carries the text on in the author's own voice.
- **Spelling & punctuation** — fixes only spelling, never swaps a word.
- **Fact check** and **source suggestions** — read-only; they cannot enter the
  document.
- **Summary** — summarizes the document or a selection as bullet points.

Multiple providers: Gemini, Claude, OpenAI, OpenRouter, NVIDIA, Groq, DeepSeek,
local Ollama, and any OpenAI-compatible service (by entering its address). Off by
default — with no model connected, the app is exactly its AI-free self.

---

## And more

- **Images** — paste from the clipboard or drag them in; they are copied into an
  `images` folder beside the document and shown inline.
- **Formulas** — LaTeX written with `$...$`, typeset with KaTeX.
- **PDF and printing** — the document prints as one whole; marks and comments
  never appear in the output.
- **Find and replace** — in-document search (`Ctrl+F`) and replace (`Ctrl+H`),
  with case folding done correctly for Turkish.
- **Embedded documents** — opens the contents of a `.md` link in place, read-only.
- **Recent files**, a **table of contents**, link following and a way back.

## Two languages

The interface is **Turkish and English**. On launch it follows your operating
system's language, and you can change it in Settings. The AI output, however,
follows **the language of the text**, independent of the interface.

## Stack

[Tauri 2](https://tauri.app/) (Rust shell) + [Vite](https://vitejs.dev/) +
[CodeMirror 6](https://codemirror.net/) + [KaTeX](https://katex.org/) +
[marked](https://marked.js.org/). Standalone `.exe` ~12 MB.

## Development

```bash
npm install
npm run app        # development (live reload)
npm run app:build  # standalone exe + MSI (src-tauri/target/release/)
npm test           # unit tests
```

## How it was made

This project was written with **vibe coding**: the product idea, design
decisions, requirements and direction are entirely the **repo owner's (Zafer
Kılıç)**; **all of the code was written by AI** under their direction. The human
decided what and how; the machine wrote the code.

## License

[MIT](LICENSE) © Zafer Kılıç
