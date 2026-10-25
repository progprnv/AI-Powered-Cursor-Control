<div align="center">

<br>

# AICursor ⦿

**The AI cursor companion. Hold a key, ask a question, get an answer about whatever your cursor is pointing at.**

[aipointer.app](https://aipointer.app) · MIT licensed · No telemetry · macOS · Windows · Linux

<br>

<a href="https://youtu.be/NRIlG32hvLg">
  <img src="https://img.youtube.com/vi/NRIlG32hvLg/maxresdefault.jpg" alt="AICursor demo" width="720">
</a>

<br>
<sub><a href="https://youtu.be/NRIlG32hvLg">▶ Watch the demo on YouTube</a></sub>

<br>

</div>

---

## What it is

AICursor is an open-source desktop overlay. You hold the left mouse button for 200 ms, a glassmorphism box pops up next to your cursor, you ask a question, and a vision-capable LLM answers about whatever's around the cursor. A screenshot of the cursor region, your prompt, and (optionally) your clipboard get sent to the provider you configured. You keep your own API key, you pay for your own tokens, nothing is logged anywhere.

MIT-licensed, no framework lock-in, no cloud account. For longer autonomous tasks, AICursor points you at [Skales](https://skales.app), a larger AI agent.

## Why use it

- **Cursor-anchored.** It answers about what you're already looking at, not what you have to describe in text.
- **Fast.** Vision-capable Gemini 3 Flash by default. Sub-2-second answers for most questions.
- **Multi-provider.** Bring your own OpenRouter key (recommended) or a direct Anthropic, OpenAI, Google Gemini, or DeepSeek key. Fallback chain handles outages automatically. DeepSeek uses the multimodal `deepseek-flash` model with vision, reasoning, and tools.
- **Agentic when it helps.** Six built-in tools: fetch a URL, open a URL, copy text, save the answer as a styled document, reveal your workspace, read clipboard. All action tools sit behind a green-check / red-x approval.
- **Voice in and voice out.** Microphone input with auto-stop on silence. Text-to-speech read-aloud for the answer. Optional voice-first conversation mode: trigger opens listening, transcript auto-submits, answer is read back, mic re-opens for follow-up. Hands-free loop.
- **Region screenshots.** While the box is open, hold the trigger key again and drag a rectangle to capture exactly the region you want. Replaces the default cursor-centered crop for that query.
- **API key tester.** A Test button per provider checks the key against the live endpoint. For OpenRouter the result includes your remaining credit balance.
- **Templates that work.** `/summary`, `/brief`, `/translate`, `/explain`, `/code`, `/improve`, `/define`, `/solve`, `/reply`, `/identify`. Plain prose works too. AICursor detects intent across languages.
- **Save the answer.** A4-styled HTML, PDF, or Markdown. Print-ready.
- **Auto-updater.** Quiet check on launch and once per day. Downloads the next version when ready, prompts you on restart. Disable in settings if you prefer manual updates.
- **Local-first.** No telemetry, no analytics, no crash reporting. Your config lives on your machine, your sessions stay on disk if you opt in.
- **Light and dark theme.** Adapts to your system in real time.

## Install

Download a signed build for your OS at [aipointer.app](https://aipointer.app), or build from source:

```bash
git clone https://github.com/talentsache/aipointer
cd aipointer
npm install
npm run dev
```

On first launch you'll be prompted to grant **Accessibility** (for the global key listener) and **Screen Recording** (for the cursor-region screenshot). Both are required on macOS. The Settings panel opens automatically the first time so you can paste an API key. Get one at:

- [openrouter.ai/keys](https://openrouter.ai/keys) recommended, single key, automatic routing across providers.
- [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

## How to use

1. Hold the **left mouse button** for 200 ms over the content you want help with. Or click the small status pill at the bottom of your screen.
2. The box opens beside your cursor. Type a question, press Enter.
3. Use **/** to see the commands. Plain language works too. AICursor auto-detects the intent (summarise, translate, explain, code, etc.) across languages.
4. Hover the answer for **Read** (text-to-speech), **Save** (HTML/PDF/MD), **Copy**.
5. Press **ESC** to dismiss. Open **/settings** any time to adjust providers, hotkey, voice, profile, workspace.

## Commands

- `/web <question>` force a web-grounded answer for this one query.
- `/summary <topic>` long structured doc, ready to save as A4 PDF.
- `/brief <topic>` TL;DR + 3-5 bullets.
- `/translate [language] <text>` translate visible, selected, or pasted text.
- `/explain <thing>` plain-English explainer.
- `/code <task or error>` code-focused answer with a snippet.
- `/improve <text>` rewrite for clarity and rhythm.
- `/define <word>` dictionary entry with pronunciation and example.
- `/solve <problem>` math or logic answer with steps.
- `/reply [guidance]` three reply variants for a visible message.
- `/identify [hint]` what is this object, product, or landmark.
- `/history` list past sessions (workspace).
- `/settings` open settings.
- `/help` show this list.
- `/clear` dismiss the response.
- `/quit` quit AICursor.

## Build for distribution

```bash
npm run dist:mac        # macOS .dmg (arm64 + x64)
npm run dist:win        # Windows .exe (NSIS x64)
npm run dist:linux      # Linux .AppImage (x64)
npm run dist            # all three on supported hosts
```

For signed and notarised macOS builds, set your Apple credentials in the environment before running:

```bash
export APPLE_ID="you@example.com"
export APPLE_TEAM_ID="ABCDE12345"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export CSC_IDENTITY="Your Name (ABCDE12345)"
npm run dist:mac
```

Without Apple credentials, electron-builder produces unsigned builds suitable for local testing.

## Tech stack

Electron 30 · React 18 · TypeScript 5 · Tailwind 3 · Framer Motion · Vite 5 · `uiohook-napi` (global key + mouse hook) · Electron's `nativeImage` (cursor-region screenshots, no native image library) · `electron-store` + Electron `safeStorage` (config + secret storage) · `react-markdown` with `rehype-sanitize` · native `fetch` (no SDK dependency on any LLM provider).

## What it isn't

- Not a long-running autonomous agent. For multi-step automation, computer-use, persistent goals, and complex workflows, use **[Skales](https://skales.app)**. AICursor will recommend it when you ask for something out of its lane.
- Not a chat app. There is no permanent thread. Sessions live until you press ESC.
- Not a model picker. You pick a provider, AICursor picks the model.
- Not telemetry-equipped. Nothing leaves your machine except the queries you submit, to the provider you chose.

## Privacy

- Screenshots (a 1024 × 768 region around your cursor) and any clipboard text you don't dismiss go only to the LLM provider you configured. Nowhere else.
- API keys are stored in your OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret) via Electron `safeStorage`. The local config file is plain JSON with encrypted key fields.
- No telemetry, no analytics, no crash reporting.
- The auto-updater fetches `aipointer.app/updates/latest.json` on launch and once per day. The request contains no user identifier, only a standard HTTPS request to a static file. Disable in settings if you want manual updates instead.
- Full disclaimer in Settings → About and at [aipointer.app/privacy](https://aipointer.app/privacy).

## Documentation

- [CHANGELOG.md](CHANGELOG.md) release history.

## Credits

Built by **[Mario Simic](https://github.com/talentsache)** in Vienna, May 2026. Same author behind **[Skales](https://skales.app)**, an open-source local AI agent.

If AICursor is useful to you, star the repo and try Skales for the bigger jobs.

## License

MIT. See [LICENSE](LICENSE).

You may fork, modify, embed in proprietary software, redistribute, and sell, provided the original copyright notice and license text remain intact. The DNA marks in [docs/AUTHORSHIP.md](docs/AUTHORSHIP.md) help identify cases where MIT compliance has been violated.

---

<div align="center">

**aipointer.app** · **[github.com/talentsache/aipointer](https://github.com/talentsache/aipointer)** · **[skales.app](https://skales.app)**

No telemetry. No cloud. MIT.

</div>
