# spec.md: LinkedIn Poster

This document specifies the whole LinkedIn Poster system, from an empty folder to a working overnight post generator and review app. It is built by an unattended build runner (`builder/`, see PROMPT.md) in 14 batches, M01 to M14. Each batch is built by one headless Claude Code session (Opus), checked by its acceptance commands, reviewed by Opus, and fixed by Sonnet when needed.

How this file is organised:

- **Global rules** (the block below) apply to every batch and are included in every batch's context.
- **Batches** M01 to M14, in build order. Each lists the appendices it needs and ends with an `acceptance` block of shell commands that must all pass.
- **Appendices** A to L hold the detailed specifications: posting rules and style files, renderers, the 2D diagram system, caption validation, Claude sessions and usage limits, stage prompts, the pipeline, the night runner, and the review app.

Files shown under a heading of the form `#### File: \`path\`` must be written to that path **verbatim**: the exact content between the `~~~~` fences, plus one trailing newline.

<!-- global:start -->

## G1. What we are building

Gabriele Bolognese is a solo founder building FlashFX, a browser-based motion graphics and video editor. On LinkedIn he publishes posts in a rotation of three formats. Each post is one image plus a caption:

1. **Hook card**: one sentence in EB Garamond on warm paper, with one highlighted phrase. Fixed template.
2. **Editorial poster**: a giant numeral, a two-line title and 4 to 9 numbered items (title, body, accent line). Fixed template.
3. **Notebook diagram**: a system drawn as hand-drawn working notes (felt-tip ink on notebook paper, six yellow highlighter numbers). Drawn entirely by code: rough.js shapes, a handwriting font with per-letter jitter. **No image generation model is used anywhere.**

The system has three parts:

- **Post pipeline** (TypeScript, `src/`): produces complete posts (PNG plus caption) using headless Claude Code sessions. Sonnet handles the text stages (idea, caption, claim audit). Opus handles everything that ends up in the image: hook card text, poster content, diagram system design, and the diagram scene code. Deterministic validators and render gates check every output, and failures are sent back to the model with exact error messages.
- **Night runner** (`runner/run.sh`, Git Bash): runs the pipeline unattended for N posts. When it hits a usage limit, it waits until the reset time plus 2 minutes and resumes. When it crashes, an Opus reviewer writes a fix file, Sonnet applies it, and the runner restarts. It prints a status line every 2 minutes.
- **Review app** (Vite + React + TypeScript, `npm run app`): every post is a card showing its image and caption. The **Post this** button downloads the PNG and copies the caption to the clipboard. Cards can be marked posted, edited, rejected and regenerated.

Gabriele publishes on LinkedIn manually. Nothing in this system talks to LinkedIn.

## G2. Environment

- Windows 11, Git Bash (MINGW64), Node.js 20 or newer, npm, Git.
- Claude Code CLI `claude`, logged in with a Claude Max plan. Headless sessions use `claude -p`.
- Repository root: `~/linkedin-poster`. The path may contain spaces.
- Network: npm registry, Playwright's Chromium download, and Claude Code itself. The product makes no other network calls at runtime. Fonts and libraries are bundled locally.

## G3. Rules for every batch

1. **Protected files.** Never modify `builder/`, `spec.md` or `PROMPT.md`. Never remove existing lines from `.gitignore`. Never change the first section of `CLAUDE.md` (you may append below it).
2. **Git.** Commit your work with the batch ID in the message. No `git push`, no remotes, no history rewriting.
3. **Dependencies.** Only the packages in G4. Install them as project dependencies. No global installs. `npx playwright install chromium` is allowed. Never rely on `npx` downloading a package that is not installed locally: call local binaries through npm scripts or `npx <local-bin>`.
4. **Windows and Git Bash safety.**
   - Build every filesystem path with `node:path` (`path.join`, `path.resolve`). Never hardcode `/c/Users/...` or backslashes.
   - Import Node built-ins with the `node:` prefix.
   - No symlinks.
   - LF line endings for every text file.
   - Quote every path in bash scripts.
   - When spawning `claude` on win32, handle `.cmd` shims (see Appendix G).
   - Directory moves retry on `EPERM`/`EBUSY`/`EACCES` (antivirus and indexers lock files on Windows), see `moveDirWithRetry`.
   - Temp files go under `out/tmp/`.
5. **TypeScript.** Strict mode, ESM (`"type": "module"`), run with `tsx`. No compile step, except the diagram browser runtime (bundled with esbuild) and the app (Vite).
6. **Validation.** Every JSON file read from disk and every JSON object returned by a model is parsed with a zod schema. Errors name the field and the problem.
7. **Tests.**
   - Use vitest (`npm test` runs `vitest run`).
   - Render tests use real Chromium.
   - Tests never call the real Claude CLI. Use the fake Claude (Appendix G). The only batch that runs real Claude is M13.
   - Every validator and every gate has positive and negative tests.
8. **Text.** All generated content is in English. No em dash (U+2014) or horizontal bar (U+2015) in any tracked text file; `npm run lint:dashes` enforces this. No en dash (U+2013) as punctuation in `style/`, `prompts/` or `content/`.
9. **Separation of measurement and judgement.** Browser code only measures and returns plain data (boxes, line counts, colors). Pass or fail decisions are pure Node functions over that data, so they can be unit-tested with synthetic inputs.
10. **Config and paths.** Always load configuration with `loadConfig()` (zod-validated, with environment overrides) and resolve directories through `src/shared/paths.ts`.
11. **One browser per process.** Reuse one Chromium instance (`getBrowser()`) for all renders in a process. Close it on exit.
12. **No real runs.** Do not run the real night runner or call real Claude in any batch except M13.
13. **Progress log.** Append your batch section to `PROGRESS.md`.
14. **Error messages.** Every thrown error says what failed, where (file, field, stage, post id) and what to do. Never fail silently.
15. **Long commands.** The Bash tool times out long commands. Pass a longer timeout (up to 10 minutes) for installs, render tests and e2e tests. Run anything longer in the background with its output in a log file, and poll that log. Never let 10 minutes pass without a tool call: the build runner kills a session after 20 silent minutes.

## G4. Allowed dependencies

| Package | Purpose |
|---|---|
| `zod` | schemas |
| `roughjs` | hand-drawn shapes in the diagram runtime |
| `react`, `react-dom` | review app |
| `typescript`, `tsx`, `@types/node`, `@types/react`, `@types/react-dom` | language and runner |
| `vitest` | unit and render tests |
| `playwright`, `@playwright/test` | rendering and app end-to-end tests |
| `esbuild` | bundling the diagram browser runtime |
| `vite`, `@vitejs/plugin-react` | review app |
| `@fontsource/eb-garamond`, `@fontsource/kalam`, `@fontsource/caveat`, `@fontsource/patrick-hand-sc` | font files (copied into `assets/fonts/`) |

Nothing else. If a batch truly cannot proceed without another package, it must record why in PROGRESS.md and choose the smallest well-known package.

## G5. Final repository layout

```
linkedin-poster/
  spec.md  PROMPT.md  CLAUDE.md  PROGRESS.md  README.md
  package.json  tsconfig.json  vitest.config.ts  config.json
  .gitignore  .gitattributes
  builder/                      # the build runner (never modify)
  runner/
    run.sh                      # night runner entry (Git Bash)
    state/                      # gitignored: lock, night.json, limit.json, fixes/
    logs/                       # gitignored
  src/
    shared/                     # config.ts paths.ts log.ts fsx.ts text.ts ids.ts rng.ts time.ts schemas.ts banned.ts
    render/
      browser.ts  fonts.ts  pixels.ts
      hook/                     # template.ts validate.ts gate.ts linebreak.ts render.ts
      poster/                   # template.ts validate.ts gate.ts render.ts
      diagram/
        runtime/                # browser code: index.ts paper.ts ink.ts lettering.ts primitives.ts icons.ts registry.ts rng.ts
        shell.ts  validate.ts  gate.ts  render.ts  bundle.ts
    captions/                   # rules.ts structure.ts emoji.ts validate.ts
    claude/                     # session.ts limits.ts prompt.ts extract.ts
    pipeline/
      stages/                   # idea.ts hookContent.ts posterContent.ts diagramDesign.ts diagramScene.ts render.ts caption.ts audit.ts publish.ts
      machine.ts  history.ts  rotation.ts  dedup.ts  phraseBank.ts  facts.ts  summary.ts  queue.ts
    runner/                     # night.ts heartbeat.ts report.ts lock.ts crash.ts
    cli/                        # entry points (see G9)
  app/
    index.html  vite.config.ts  tsconfig.json
    server/api.ts               # Vite middleware: /api/*
    src/                        # main.tsx App.tsx components/ lib/ styles.css
  style/                        # voice, format rules, caption rules, banned phrases, diagram API (Appendix A, E)
  prompts/                      # stage prompt templates (Appendix H)
  content/
    facts.md  pillars.md  phrase-bank.md      # tracked, edited by Gabriele
    _staging/  posts/  _failed/  runs/  history.json  queue.json   # gitignored
  assets/
    fonts/                      # copied woff2 files + licenses/
    notebook/                   # optional page.jpg for the photo paper mode
    reference/                  # optional golden PNGs for calibration
  scripts/                      # copy-fonts.ts check-dashes.ts build-runtime.ts check-spec-files.ts
  tests/                        # *.test.ts, fixtures/, fake-claude/, runner/*.sh, e2e/
  docs/                         # first-run-review.md (M13)
  out/                          # gitignored build and test output
```

## G6. Glossary

- **Format**: `hook`, `poster` or `diagram`.
- **Post**: one image (`image.png`) plus one caption, with metadata in `post.json`.
- **Stage**: one step of the pipeline (idea, content, scene, render, caption, audit, publish).
- **Validator**: a pure function that checks a JSON or text output against the rules. It returns a list of issues.
- **Gate**: measures a rendered image in the browser, then a pure function decides pass or fail.
- **Staging**: `content/_staging/<postId>/`, where a post is built. The app never reads it.
- **Publish**: atomic move of a finished post from staging to `content/posts/<postId>/`.
- **Run**: one invocation of the night runner, identified by a `runId`.
- **Rotation**: the cyclic order of formats (`hook`, `poster`, `diagram`), continued across runs.
- **Repair**: rerunning a stage's prompt with the previous output and the exact error list attached.

## G7. `config.json` (complete, with defaults)

```json
{
  "rotation": ["hook", "poster", "diagram"],
  "defaultCount": 12,
  "postsPerDay": 1,
  "contentDir": "content",
  "models": {
    "idea": "sonnet",
    "hookContent": "opus",
    "posterContent": "opus",
    "diagramDesign": "opus",
    "diagramScene": "opus",
    "caption": "sonnet",
    "audit": "sonnet",
    "crashReview": "opus",
    "crashFix": "sonnet"
  },
  "retries": {
    "idea": 3,
    "contentRepair": 2,
    "gateRepair": 2,
    "sceneSessions": 2,
    "captionRepair": 2,
    "auditRepair": 1
  },
  "sessions": {
    "stallMinutes": 15,
    "maxMinutes": 20,
    "sceneMaxMinutes": 45,
    "maxTurns": 6,
    "sceneMaxTurns": 60,
    "crashMaxTurns": 120
  },
  "hook": { "width": 1080, "height": 1350, "maxChars": 90 },
  "poster": {
    "width": 1080,
    "accent": "#2F7A3E",
    "footer": "Gabriele Bolognese  ·  building FlashFX in public"
  },
  "diagram": {
    "width": 1080,
    "height": 1350,
    "paper": "dots",
    "photo": { "file": "assets/notebook/page.jpg", "drawArea": { "x": 0, "y": 0, "w": 1080, "h": 1350 } },
    "handwritingFont": "Kalam",
    "inkColor": "#1d1d22",
    "highlighter": "rgba(255, 214, 0, 0.55)",
    "roughness": 1.5,
    "maxTiltDegrees": 1.2
  },
  "caption": {
    "hookMaxChars": 140,
    "ranges": { "hook": [900, 1300], "poster": [400, 700], "diagram": [600, 900] }
  },
  "dedup": { "historyWindow": 150, "similarityThreshold": 0.5 },
  "usageLimit": { "bufferMinutes": 2, "fallbackMinutes": 30, "transientBackoffMinutes": [1, 2, 5, 10, 20] },
  "crashFixer": { "maxFixesPerNight": 3 },
  "heartbeatSeconds": 120,
  "claude": { "bin": "claude", "prefixArgs": [] },
  "app": { "port": 5173 }
}
```

Environment overrides, applied by `loadConfig()` after reading the file:

| Variable | Overrides |
|---|---|
| `LP_CONTENT_DIR` | `contentDir` (relative paths resolve against the repo root) |
| `LP_CLAUDE_BIN` | `claude.bin` |
| `LP_CLAUDE_PREFIX_ARGS` | `claude.prefixArgs` (JSON array string) |
| `LP_HEARTBEAT_SECONDS` | `heartbeatSeconds` |
| `LP_FAKE=1` | sets `claude.bin` to `node` and `claude.prefixArgs` to `["tests/fake-claude/fake-claude.mjs"]` |
| `LP_NOW` | the current time used by `now()` (ISO string, tests only) |
| `LP_WAIT_SCALE` | multiplies every wait duration (tests only, for example `0.001`) |

## G8. Data model

**Staging and post folders** (identical file names; `post.json` exists only after publish, `failure.json` only in `_failed/`):

```
<postId>/
  stage.json          # { postId, format, runId, completed: string[], attempts: Record<stage, number>, history: [...] }
  idea.json           # idea stage output
  card.json           # hook only
  poster.json         # poster only
  diagram.json        # diagram only
  scene.js            # diagram only
  image.html          # exactly the HTML that was rendered (for the diagram, the shell)
  image.png
  gate.json           # { pass, issues: [{ code, message, detail }], measurements }
  caption.txt         # the caption, plain text, LF line breaks, no trailing spaces
  validation.json     # caption validator result
  audit.json          # claim audit result
  prompts/<stage>-<n>.md
  logs/<stage>-<n>.jsonl
  post.json           # after publish
  failure.json        # in _failed/: { stage, reason, issues, at }
```

**Post id**: `<YYYYMMDD>-<HHMMSS>-<format>-<slug>`. The slug comes from the topic: lowercase ASCII, words joined by dashes, max 40 characters. Example: `20261112-021503-poster-rules-i-ship-ai-code-by`.

**`post.json`** (zod schema `PostSchema` in `src/shared/schemas.ts`):

```ts
{
  id: string;
  format: "hook" | "poster" | "diagram";
  createdAt: string;            // ISO
  runId: string;
  pillar: number;               // 1..6
  topic: string;
  angle: string;
  keyTerms: string[];
  factIds: string[];
  content: HookCard | PosterContent | DiagramSpec;   // the validated card.json / poster.json / diagram.json
  caption: string;
  captionChars: number;         // grapheme count
  image: { file: "image.png"; width: number; height: number };
  audit: { unsupported: number; claims: AuditClaim[] };
  status: "ready" | "posted" | "rejected";
  postedAt: string | null;
  editedCaption: string | null; // set by the app, used by Post this when present
  rejectedReason: string | null;
  models: Record<string, string>;      // stage -> model used
  durationsMs: Record<string, number>; // stage -> time spent
  regeneratedFrom: string | null;
}
```

**`content/history.json`**: array, oldest first, of `{ id, format, pillar, topic, angle, keyTerms, phraseOrTitle, createdAt, status: "ready" | "failed" }`. Written atomically.

**Run report** `content/runs/<runId>.json` (plus a human-readable `<runId>.md` and a copy at `content/runs/latest.json`):

```ts
{ runId, startedAt, finishedAt, target, fake: boolean,
  ready: string[], failed: { id, format, stage, reason }[],
  waits: { from, until, reason }[], crashes: number, fixes: number,
  durationsMs: { total: number, perPost: Record<string, number> } }
```

## G9. npm scripts (final set; the batch that adds each one is in brackets)

| Script | Command | Batch |
|---|---|---|
| `typecheck` | `tsc --noEmit -p tsconfig.json` (M12 appends `&& tsc --noEmit -p app/tsconfig.json`) | M01 |
| `test` | `vitest run` | M01 |
| `lint:dashes` | `tsx scripts/check-dashes.ts` | M01 |
| `fonts` | `tsx scripts/copy-fonts.ts` | M02 |
| `render:fixtures` | `tsx src/cli/render-fixtures.ts` | M03 |
| `calibrate` | `tsx src/cli/calibrate.ts` | M03 |
| `runtime:build` | `tsx scripts/build-runtime.ts` | M05 |
| `bakeoff` | `tsx src/cli/bakeoff.ts` | M06 |
| `prompts:check` | `tsx src/cli/prompts-check.ts` | M09 |
| `prompts:preview` | `tsx src/cli/prompts-preview.ts` | M09 |
| `gen` | `tsx src/cli/gen.ts` | M10 |
| `night` | `bash runner/run.sh` | M11 |
| `app` | `vite --config app/vite.config.ts` | M12 |
| `app:build` | `vite build --config app/vite.config.ts` | M12 |
| `e2e` | `playwright test --config tests/e2e/playwright.config.ts --reporter=list` | M12 |
| `doctor` | `tsx src/cli/doctor.ts` | M14 |

`vitest.config.ts`: include `tests/**/*.test.ts`, exclude `tests/e2e/**`, `testTimeout: 60000`, `hookTimeout: 60000`, `fileParallelism: false` (one Chromium at a time keeps Windows stable).

## G10. Shared conventions

- `src/shared/log.ts`: `log(line)` prints `[HH:MM:SS] line`. If a log file is configured, the line is also appended there without ANSI codes. Also `warn`, `error`, `ok` with colors.
- `src/shared/fsx.ts`: `atomicWriteJson(path, data)` (write a temp file in the same dir, then rename), `readJson(path, schema)`, `ensureDir`, `moveDirWithRetry(src, dst)` (rename, retry 6 times with 500 ms delay on EPERM/EBUSY/EACCES, then fall back to recursive copy and delete), `listDirs(path)`.
- `src/shared/text.ts`: `graphemes(s)` (via `Intl.Segmenter`), `graphemeLength(s)`, `slugify(s, max)`, `normalizeSpaces(s)`, `words(s)`.
- `src/shared/ids.ts`: `newPostId(format, topic, date)`, `newRunId(date)` (`run-YYYYMMDD-HHMMSS`).
- `src/shared/rng.ts`: `hashSeed(string) -> uint32` (FNV-1a), `mulberry32(seed) -> () => number`.
- `src/shared/time.ts`: `now()` honours `LP_NOW`. `sleep(ms)` honours `LP_WAIT_SCALE`.
- Exit codes for product CLIs: `0` ok, `1` failure, `2` invalid usage. The night runner process uses `75` (usage limit, wait), `76` (transient, back off) and other non-zero values (crash, see Appendix J).

<!-- global:end -->

# Batches

<!-- batch:M01:start -->
## M01. Scaffold and shared conventions

**Goal.** An empty folder becomes a typed, tested TypeScript project with the shared utilities every later batch uses.

**Build.**
- `package.json`: `"name": "linkedin-poster"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=20" }`, scripts `typecheck`, `test`, `lint:dashes` (G9).
- Install `zod`, and dev dependencies `typescript`, `tsx`, `vitest`, `@types/node`.
- `tsconfig.json`: `strict: true`, `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `types: ["node"]`, `noEmit: true`, `skipLibCheck: true`, `resolveJsonModule: true`, `esModuleInterop: true`, `include: ["src", "tests", "scripts"]`.
- `vitest.config.ts` as in G9.
- Create the directory tree of G5 (use `.gitkeep` files in empty directories). Do not create `app/` yet.
- Append to `.gitignore` (keep every existing line):
  ```
  content/_staging/
  content/posts/
  content/_failed/
  content/runs/
  content/history.json
  content/queue.json
  runner/state/
  runner/logs/
  test-results/
  playwright-report/
  ```
- `config.json` exactly as G7.
- `src/shared/config.ts`: zod schema for G7, `loadConfig(env = process.env)`, environment overrides from G7. Validate that rotation contains only known formats and that caption ranges have min < max. The result is frozen.
- `src/shared/paths.ts`: `repoRoot` (resolved from this file's location), `contentDir(cfg)`, plus `stagingDir`, `postsDir`, `failedDir`, `runsDir`, `historyFile`, `queueFile`, `styleDir`, `promptsDir`, `assetsDir`, `fontsDir`, `outDir`, `runnerStateDir`.
- `src/shared/log.ts`, `fsx.ts`, `text.ts`, `ids.ts`, `rng.ts`, `time.ts` as in G10.
- `src/shared/schemas.ts`: start with `FormatSchema`, `HistoryEntrySchema`, `PostSchema` (G8). Content schemas are added by M03, M04 and M06; until then use `z.unknown()` for `content`, with a comment saying which batch replaces it.
- `scripts/check-dashes.ts`: list files with `git ls-files -co --exclude-standard`, skip binary extensions (`png jpg jpeg gif webp woff woff2 ttf otf ico pdf zip`), and skip `spec.md` and `PROMPT.md` (protected; they are clean already). Report `path:line:col` for every U+2014 or U+2015, and every U+2013 in files under `style/`, `prompts/` or `content/`. Exit 1 if any are found. Export the scanning function for tests.
- `src/cli/print-config.ts`: prints the resolved config as JSON.
- `CLAUDE.md`: keep the first section unchanged and append `## Project conventions` with the key commands (`npm test`, `npm run typecheck`, `npm run lint:dashes`), a pointer to G5 for layout, and the rule "browser measures, Node decides" (G3.9).
- `README.md`: title, one paragraph of purpose, and the line "Full documentation is written in batch M14."

**Tests** (`tests/shared/*.test.ts`):
- Config: defaults load. Each env override works. An invalid rotation value is rejected with a message naming the field.
- Text: `graphemeLength("→ 🧭 ok")` is 6. `slugify("Rules I Ship: AI Code By!", 40)` is `rules-i-ship-ai-code-by`.
- Ids: format of post and run ids with a fixed date.
- RNG: the same seed gives the same sequence. Different seeds give different sequences.
- fsx: an atomic write leaves no temp file. `moveDirWithRetry` moves a directory with nested files.
- check-dashes: the scanner finds U+2014 in a string and reports line and column. It ignores U+2013 outside the style, prompts and content folders.

**Done when** the acceptance commands pass and PROGRESS.md has the M01 section.

```acceptance
# timeout-minutes: 15
npm run typecheck
npm test
npm run lint:dashes
npx tsx src/cli/print-config.ts
test -f CLAUDE.md
test -f README.md
test -f config.json
```
<!-- batch:M01:end -->

<!-- batch:M02:start -->
## M02. Fonts and the shared browser renderer

<!-- needs: B -->

**Goal.** Local fonts, and one reliable way to turn HTML into a PNG and measure it, shared by all three formats.

**Build.**
- Install `@fontsource/eb-garamond`, `@fontsource/kalam`, `@fontsource/caveat`, `@fontsource/patrick-hand-sc` and `playwright` (dev dependencies).
- `scripts/copy-fonts.ts` and `npm run fonts` (Appendix B1): copy the woff2 files into `assets/fonts/` with the target names, and copy each package's license into `assets/fonts/licenses/`. Commit the copied fonts (they are small and make renders independent of node_modules).
- `src/render/fonts.ts`: `fontFaceCss(families: FontRef[])` returns `@font-face` rules pointing at `http://lp.local/fonts/<file>`. Export the font table.
- `src/render/browser.ts` (Appendix B2): `getBrowser`, `closeBrowser`, `renderHtml`, `fontsLoaded`, the virtual origin `http://lp.local/`, console and page error capture.
- `src/render/pixels.ts` (Appendix B3): `sampleRegions(pngBuffer, regions)` returns average RGB and mean saturation per region, computed in a browser canvas (no PNG library).
- Run `npx playwright install chromium`.

**Tests** (`tests/render/browser.test.ts`):
- Render a 400 x 200 page that uses EB Garamond through `lp.local`: the PNG exists with the right dimensions and `fontsLoaded` reports true for `400 32px "EB Garamond"` and `italic 400 32px "EB Garamond"`.
- A page referencing a missing font file: `fontsLoaded` is false and the 404 is reported in `consoleErrors`.
- A page that throws in a script: `renderHtml` rejects with the page error message.
- Determinism: rendering the same HTML twice gives byte-identical PNGs.
- `sampleRegions` on a page with a solid `#E9E8E4` background returns that color within 1 unit per channel.

```acceptance
# timeout-minutes: 25
npm run fonts
test -f assets/fonts/eb-garamond-400-normal.woff2
test -f assets/fonts/eb-garamond-400-italic.woff2
test -f assets/fonts/eb-garamond-700-normal.woff2
test -f assets/fonts/kalam-700-normal.woff2
npx playwright install chromium
npm test -- tests/render/browser
npm run typecheck
npm run lint:dashes
```
<!-- batch:M02:end -->

<!-- batch:M03:start -->
## M03. Hook card: template, validator, gate, line-break rescue

<!-- needs: A, B, C, F -->

**Goal.** The hook card renders exactly like Gabriele's tuned template, ported to Chromium. Bad content and bad renders are caught deterministically.

**Build.**
- `src/render/hook/template.ts`: `hookLayout(lines)` and `hookCardHtml(lines, opts)`, exactly as Appendix C3.
- `style/banned-phrases.txt` verbatim from Appendix A, and `src/shared/banned.ts`: `loadBanned()` reads it (skip `#` comments and blank lines, lowercase), `findBanned(text, list)` returns the matched phrases (Appendix F2 describes the matching rules: case-insensitive, whole words, phrases ending in `?` matched literally). Every validator uses it.
- `src/render/hook/validate.ts`: `validateCard(card, cfg, banned)` implementing Appendix C2. Add `HookCardSchema` to `src/shared/schemas.ts`.
- `src/render/hook/gate.ts`: browser measurement plus the pure `judgeHookGate(measurements, card)` (Appendix C4).
- `src/render/hook/linebreak.ts`: `rescueLineBreaks(card, measure)` (Appendix C5).
- `src/render/hook/render.ts`: `renderHookCard(card, outDir, cfg)` writes `image.html`, `image.png` and `gate.json`. When the gate fails only because of line width or line count, it runs the rescue once, re-renders, and returns `{ gate, card }` (the card possibly has new lines, and `rescued: true`).
- `src/cli/render-fixtures.ts` with `--format hook|poster|diagram|all` (only hook for now): renders every fixture in `tests/fixtures/hook/` into `out/fixtures/hook/<name>/`, prints the gate results, and exits 1 if any fixture whose name does not start with `bad-` fails.
- `src/cli/calibrate.ts` (Appendix C6).
- Fixture files from Appendix C7, verbatim.
- Calibrate the grain as described in Appendix C3 (look at the rendered PNG with the Read tool), and record the final grain opacity in PROGRESS.md.

**Tests** (`tests/hook/*.test.ts`):
- `hookLayout`: font size tiers at the boundaries 40/41, 60/61, 85/86 (counting tag characters), and TOP for 2 and 3 lines.
- Validator: each rule in C2 has a failing case and the fixtures pass. Each issue has the right `code`.
- Gate judge with synthetic measurements: a wrapped line, a text bottom below 810, missing fonts, and wrong PNG dimensions each fail with their code. Correct measurements pass.
- Rendering: `taste` and `what-not-to-ship` pass the gate. `rescue` fails first, is rescued, and passes. The rescued lines keep the highlight whole and fit.
- HTML escaping: a phrase containing `&` and `<` renders as text.

```acceptance
# timeout-minutes: 25
npm run typecheck
npm test -- tests/hook
npm run render:fixtures -- --format hook
test -f out/fixtures/hook/taste/image.png
test -f out/fixtures/hook/what-not-to-ship/image.png
test -f out/fixtures/hook/rescue/image.png
npm run lint:dashes
```
<!-- batch:M03:end -->

<!-- batch:M04:start -->
## M04. Editorial poster: template, validator, gate

<!-- needs: A, B, D -->

**Goal.** The poster renders exactly like the tuned template for every item count from 4 to 9, and overflow is caught deterministically.

**Build.**
- `src/render/poster/template.ts`: `posterLayout(n, hasFooter)` and `posterHtml(poster, cfg)`, exactly as Appendix D3.
- `src/render/poster/validate.ts`: `validatePoster(poster, cfg, banned)` (Appendix D2). Add `PosterContentSchema` to schemas.
- `src/render/poster/gate.ts`: measurement plus `judgePosterGate` (Appendix D4).
- `src/render/poster/render.ts`: `renderPoster(poster, outDir, cfg)`.
- Extend `render-fixtures` with `--format poster`: from `tests/fixtures/poster/items-9.json`, derive counts 4 to 9 (first N items, `number` = N) into `out/fixtures/poster/items-<N>/`, plus the `bad-overflow` fixture (expected to fail).
- Fixture file from Appendix D5, verbatim.

**Tests** (`tests/poster/*.test.ts`):
- `posterLayout` heights for every count, with and without footer (compare with the table in D3).
- Validator: every rule in D2 has a failing case. The fixture passes.
- Gate judge with synthetic boxes: overlap between two items, item overlapping the numeral, title cap on 3 lines, an item title on 3 lines, footer collision. Each fails with its code.
- Rendering: counts 4 to 9 all pass the gate. `bad-overflow` (item 4's body is 420 characters, Appendix D5) fails with `overlap`.

```acceptance
# timeout-minutes: 25
npm run typecheck
npm test -- tests/poster
npm run render:fixtures -- --format poster
test -f out/fixtures/poster/items-4/image.png
test -f out/fixtures/poster/items-9/image.png
npm run lint:dashes
```
<!-- batch:M04:end -->

<!-- batch:M05:start -->
## M05. Diagram runtime: paper, ink, lettering, primitives

<!-- needs: B, E -->

**Goal.** A browser runtime that draws convincing hand-drawn notebook diagrams from a short scene script, and records the geometry of everything it draws.

**Build.**
- Install `roughjs` and `esbuild`.
- `src/render/diagram/runtime/*.ts` (Appendix E2 to E5): paper modes, ink and highlighter layers, jittered lettering, every primitive of the API, the icon set, the registry, seeded randomness.
- `src/render/diagram/bundle.ts` and `scripts/build-runtime.ts`: bundle the runtime with esbuild into `out/runtime/diagram-runtime.js` (IIFE, target es2020). `ensureRuntime()` rebuilds when any runtime source is newer than the bundle.
- `src/render/diagram/shell.ts`: `diagramShellHtml(cfg, seed, sceneUrl)` (Appendix E6).
- `src/render/diagram/render.ts`: `renderDiagram({ dir, out, cfg, seed })` loads `dir/scene.js` through `http://lp.local/post/scene.js`, waits for `window.__diagramReady`, screenshots to `out/image.png`, writes `out/image.html`, and returns the registry (`window.__diagram`).
- `style/diagram-api.md` verbatim from Appendix E4 (it is also included in the scene prompt, so it must match the implementation exactly).
- Fixture files from Appendix E8: `tests/fixtures/diagram/delegation-loop/diagram.json` verbatim, and the starter `scene.js`.

**Tests** (`tests/diagram/runtime/*.test.ts`):
- The fixture renders without page errors. The registry has the title, 6 elements, 6 arrows and 6 markers, with sane bounding boxes inside the canvas.
- Seeded determinism: the same seed gives byte-identical PNGs. A different seed changes the PNG.
- Every primitive and every icon renders in an isolated test scene and registers the right kind and text count.
- Lettering: every glyph of a label gets its own `tspan` with a rotation within plus or minus 3.5 degrees.
- A scene that calls an unknown function, or throws, reports the error in `window.__diagram.errors`, and `renderDiagram` rejects with that message.
- All four paper modes render (for `photo`, a generated test JPEG under `out/tmp`).

```acceptance
# timeout-minutes: 30
npm run runtime:build
test -f out/runtime/diagram-runtime.js
npm run typecheck
npm test -- tests/diagram/runtime
npm run lint:dashes
```
<!-- batch:M05:end -->

<!-- batch:M06:start -->
## M06. Diagram: validator, gate, check CLI, font bake-off

<!-- needs: A, B, E -->

**Goal.** Diagram content and diagram renders are judged deterministically, Opus gets a check command it can run while drawing, and Gabriele gets a page to pick the handwriting font.

**Build.**
- `src/render/diagram/validate.ts`: `validateDiagramSpec(spec, cfg, banned)` (Appendix E7.1). Add `DiagramSpecSchema` to schemas.
- `src/render/diagram/gate.ts`: `judgeDiagramGate(registry, spec, cfg)` (Appendix E7.2), including the cross-check between scene and spec.
- `src/cli/diagram-check.ts --dir <dir> [--out <dir>] [--seed <n>]` (Appendix E7.3).
- Extend `render-fixtures` with `--format diagram` (renders and gates every folder in `tests/fixtures/diagram/`; folders starting with `bad-` must fail).
- `tests/fixtures/diagram/bad-overlap/`: a copy of the fixture with two elements placed on top of each other (write it yourself).
- `src/cli/bakeoff.ts` and `npm run bakeoff` (Appendix E9).

**Tests** (`tests/diagram/*.test.ts`, outside `runtime/`):
- Validator: every rule in E7.1 has a failing case. The fixture spec passes.
- Gate judge with synthetic registries: overlap, out of safe area, label crossed by an arrow, missing marker, marker order too regular (left to right, and top to bottom), too few kinds, content cluster too small, labels that differ from the spec. Each fails with its code.
- The fixture passes the full check. `bad-overlap` fails with `overlap`.
- `diagram-check` exit codes: 0 pass, 1 gate fail, 2 scene error.

```acceptance
# timeout-minutes: 30
npm run typecheck
npm test -- tests/diagram
npx tsx src/cli/diagram-check.ts --dir tests/fixtures/diagram/delegation-loop --out out/fixtures/diagram/delegation-loop
test -f out/fixtures/diagram/delegation-loop/image.png
npm run render:fixtures -- --format diagram
npm run bakeoff
test -f out/bakeoff/index.html
npm run lint:dashes
```
<!-- batch:M06:end -->

<!-- batch:M07:start -->
## M07. Caption rules engine

<!-- needs: A, F -->

**Goal.** Every hard caption rule from Gabriele's posting rules becomes a deterministic check with a precise error message, which the pipeline feeds back to Sonnet.

**Build.**
- `src/captions/*.ts` (Appendix F): structure parser, emoji detection, format-specific checks, `validateCaption(text, format, content, cfg)`. Banned phrases come from `src/shared/banned.ts` (M03).
- `src/cli/validate-caption.ts --format <f> --file <caption.txt> [--content <json>]`: prints the issues and exits 1 if any rule fails.
- Fixture captions from Appendix F5, verbatim. Write at least 15 additional invalid captions as test cases (inline in tests is fine), at least one per rule.

**Tests** (`tests/captions/*.test.ts`):
- The three valid fixtures pass with their content files.
- One failing test per rule code in F2, each checking the exact code.
- Emoji edge cases: `→` is not an emoji. `©` alone counts as an emoji. A ZWJ family sequence counts as one. Skin-tone modifiers count as one. A face emoji is rejected with `emoji-face`.
- Counting: the length is in graphemes, and the hook limit applies to the first line only.

```acceptance
# timeout-minutes: 15
npm run typecheck
npm test -- tests/captions
npx tsx src/cli/validate-caption.ts --format diagram --file tests/fixtures/captions/diagram-valid-1.txt --content tests/fixtures/diagram/delegation-loop/diagram.json
npx tsx src/cli/validate-caption.ts --format hook --file tests/fixtures/captions/hook-valid-1.txt --content tests/fixtures/hook/taste.json
npx tsx src/cli/validate-caption.ts --format poster --file tests/fixtures/captions/poster-valid-1.txt --content tests/fixtures/poster/items-9.json
npm run lint:dashes
```
<!-- batch:M07:end -->

<!-- batch:M08:start -->
## M08. Claude sessions, usage limits, prompt engine, fake Claude

<!-- needs: G -->

**Goal.** One robust way to run a headless Claude Code session from TypeScript. It handles streaming, stalls, usage limits, model checks and output extraction, and comes with a fake CLI so everything else can be tested without spending usage.

**Build.**
- `src/claude/limits.ts`: `isLimitMessage`, `parseLimit` (Appendix G2), same behavior as `builder/lib/limits.mjs` (you may read that file for reference but must not import it or modify it).
- `src/claude/session.ts`: `runClaude(opts)` (Appendix G1).
- `src/claude/prompt.ts`: the template engine (Appendix G3).
- `src/claude/extract.ts`: `extractJson(text, schema)` and `extractCaption(text)` (Appendix G4).
- `tests/fake-claude/fake-claude.mjs` (Appendix G5) and its fixture responses.
- `src/cli/limits-selftest.ts`: runs the table from G2 and prints `limits self-test: N passed`.

**Tests** (`tests/claude/*.test.ts`), all with the fake CLI:
- An ok session returns the final text, turn count and model, and writes the raw jsonl log.
- A limit session returns `limit` with the parsed `resetAt`. With an epoch message, `resetAt` equals that epoch.
- A stall (fake sleeps, `stallMinutes` 0.02) returns `stall`, and the process is gone afterwards.
- A max-turns error returns `error`. An overloaded error returns `transient`.
- A model-family mismatch in the init event returns `limit` with the fallback reset.
- `prompt.ts`: variables, includes, nested includes, a missing variable throws, a missing include throws, a cycle throws.
- `extract.ts`: JSON inside a fenced block, JSON with prose around it, invalid JSON reports the parse position, schema errors list the fields. Caption extraction from a `caption` fence keeps the inner line breaks exactly.

```acceptance
# timeout-minutes: 20
npm run typecheck
npm test -- tests/claude
npx tsx src/cli/limits-selftest.ts
npm run lint:dashes
```
<!-- batch:M08:end -->

<!-- batch:M09:start -->
## M09. Style files, content seeds, stage prompts

<!-- needs: A, H -->

**Goal.** All posting rules and stage prompts exist as files, render without missing variables, and match this spec exactly.

**Build.**
- Write every `#### File:` block of Appendix A and Appendix H verbatim (some already exist from M05 and M07: check them).
- `scripts/check-spec-files.ts`: parses `spec.md`. For every heading `#### File: \`<path>\`` followed by a `~~~~` fenced block, it checks that the file exists and that its content equals the block content plus one trailing newline. It prints a diff summary for mismatches and exits 1 on any mismatch. It only reads spec.md.
- `src/cli/prompts-check.ts`: for every stage and format combination in Appendix H's variable table, renders the template with realistic sample variables (from the fixtures) and checks that no `{{` remains, every include exists, and the rendered prompt starts with `STAGE: `. It prints the size of each rendered prompt.
- `src/cli/prompts-preview.ts --stage <s> --format <f>`: prints the rendered prompt with sample variables.
- `src/pipeline/facts.ts`: `loadFacts(contentDir)` parses `content/facts.md` (Appendix A, facts format). It returns usable facts and skipped VERIFY facts, and renders the facts block for prompts.
- `src/pipeline/phraseBank.ts`: parses and updates `content/phrase-bank.md` (Appendix I6).

**Tests** (`tests/prompts/*.test.ts`):
- Every stage renders for every applicable format.
- The facts parser skips VERIFY lines and lines without an id, and rejects duplicate ids.
- Phrase bank: take the first queued phrase, mark it used with a post id, put it back on failure. The file round-trips without losing comments.

```acceptance
# timeout-minutes: 15
npx tsx scripts/check-spec-files.ts
npm run prompts:check
npm run prompts:preview -- --stage caption --format diagram
npm test -- tests/prompts
npm run typecheck
npm run lint:dashes
```
<!-- batch:M09:end -->

<!-- batch:M10:start -->
## M10. Post pipeline: stages, state machine, history, rotation

<!-- needs: A, C, D, E, F, G, H, I -->

**Goal.** One command produces complete, validated posts end to end, resumes after interruption, and never shows half-built posts.

**Build.**
- `src/pipeline/stages/*.ts`, `machine.ts`, `history.ts`, `rotation.ts`, `dedup.ts`, `summary.ts` exactly as Appendix I.
- `src/cli/gen.ts`: `--count <n>`, `--format <f>` (forces a single format), `--rotation-start <f>`, `--fake` (sets `LP_FAKE=1`), `--content-dir <dir>`, `--fresh` (deletes and recreates that content dir first; refuses when the dir is the real `content/` unless `--yes`), `--resume <postId>`. It runs posts sequentially in one process, prints stage events, and exits with the codes from Appendix I9.
- `src/cli/assert-content.ts`: `--content-dir <dir>` with `--ready <n>` (exactly n posts in `posts/` with status ready and valid `post.json`) or `--ready-min <n>`, `--formats a,b,c` (each format present), `--run latest --min-ready <n> [--max-age-hours <h>]` (reads `runs/latest.json`). For `--content-dir` checks it also re-validates every post's caption and the existence and dimensions of its PNG.
- Extend the fake Claude so every stage of Appendix H returns a valid fixture response, the scene stage copies the fixture scene into the post dir, and the idea stage varies its topic so dedup accepts it (G5).

**Tests** (`tests/pipeline/*.test.ts`, all with the fake CLI and a temp content dir):
- One post per format reaches `posts/` with every file of G8, and `post.json` validates.
- Rotation continues from history: after hook comes poster. `--format` overrides it.
- Dedup rejects an idea too similar to history and retries. With `idea-duplicate`, the retries run out and the post fails at the idea stage.
- Repair loop (`LP_FAKE_SCENARIO=caption-invalid-once`): the fake returns an invalid caption first and a valid one second, and the post succeeds with 2 caption attempts recorded.
- Gate repair (`poster-wrap-once`): the first poster content passes the validator but its title wraps in the render. The repair fixes it.
- Audit (`audit-unsupported-once`): an unsupported claim in the caption triggers one caption repair.
- Resume: interrupt after the content stage (simulate a limit outcome), rerun with the same post id, and completed stages are not repeated.
- Failure: a post that exhausts retries moves to `_failed/` with `failure.json`, and the run continues with the next post.
- Phrase bank: a hook post uses the queued phrase verbatim and marks it used.

```acceptance
# timeout-minutes: 30
npm run typecheck
npm test -- tests/pipeline
npm run gen -- --fake --count 3 --content-dir out/test-content --fresh
npx tsx src/cli/assert-content.ts --content-dir out/test-content --ready 3 --formats hook,poster,diagram
npm run lint:dashes
```
<!-- batch:M10:end -->

<!-- batch:M11:start -->
## M11. Night runner: Git Bash runner, waits, heartbeat, crash fixer, reports

<!-- needs: G, I, J -->

**Goal.** `bash runner/run.sh --count 12` runs overnight with no supervision, waits out usage limits, repairs its own crashes within limits, and leaves a clear report.

**Build.**
- `runner/run.sh` (Appendix J1 to J3): argument parsing, preflight, lock, outer loop over exit codes, usage-limit waits with countdown, transient backoff, crash fixer flow, final summary.
- `src/runner/night.ts` and `src/cli/run-night.ts` (Appendix J4): the in-process loop over posts with `--resume`, `night.json` state, heartbeat every 2 minutes, event lines, run report.
- `src/runner/crash.ts` and `src/cli/claude-run.ts` (Appendix J5): run a crash review or crash fix session through `runClaude`, for `run.sh` to call.
- `src/runner/report.ts`: `content/runs/<runId>.json`, `.md` and `latest.json`.
- `src/runner/lock.ts`: lock file helpers used by `run-night.ts`.
- `tests/runner/limit-sim.sh` and `tests/runner/crash-sim.sh` (Appendix J7).
- Add the `night` script.

**Tests** (`tests/runner/*.test.ts`): heartbeat line format; report generation from a synthetic night state; lock acquire, refuse and stale takeover; resume picks up `currentPostId`.

```acceptance
# timeout-minutes: 30
bash runner/run.sh --fake --count 3 --content-dir out/night-test --fresh --yes
npx tsx src/cli/assert-content.ts --content-dir out/night-test --ready 3
bash tests/runner/limit-sim.sh
bash tests/runner/crash-sim.sh
npm test -- tests/runner
npm run typecheck
npm run lint:dashes
```
<!-- batch:M11:end -->

<!-- batch:M12:start -->
## M12. Review app

<!-- needs: F, K -->

**Goal.** A local web app where every post is a card. One click on **Post this** downloads the image and copies the caption, ready to paste into LinkedIn.

**Build.**
- Install `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@playwright/test`.
- `app/` exactly as Appendix K: Vite config with the API middleware, React UI, styles.
- `app/tsconfig.json` (JSX, DOM) and extend the `typecheck` script (G9).
- `tests/app/api.test.ts`: API handler tests against a temp content dir.
- `tests/e2e/playwright.config.ts` and `tests/e2e/app.spec.ts` (Appendix K6): the web server runs `npm run app -- --port 5199 --strictPort` with `LP_CONTENT_DIR` pointing at a fixture content dir generated in global setup by `npm run gen -- --fake --count 3 --content-dir out/e2e-content --fresh`.

```acceptance
# timeout-minutes: 30
npm run typecheck
npm test -- tests/app
npm run app:build
npm run e2e
npm run lint:dashes
```
<!-- batch:M12:end -->

<!-- batch:M13:start -->
## M13. Real end-to-end run and tuning (uses real Claude)

<!-- needs: A, C, D, E, F, G, H, I, J -->

**Goal.** Prove the system with real models, and fix whatever the fake hid. This is the only batch allowed to call real Claude.

**Build.**
1. Run `bash runner/run.sh --count 3 --rotation-start hook --yes`. This produces one post per format in the real `content/` folder. These are real posts for Gabriele's queue. A run takes much longer than the Bash tool's timeout, so start it in the background (`bash runner/run.sh --count 3 --rotation-start hook --yes > out/m13-run-<n>.log 2>&1 &`) and poll the log with `tail -n 30` every 3 to 5 minutes until the final summary appears. Never let more than 10 minutes pass without a tool call: the build runner treats 20 silent minutes as a stall.
2. For every post, open `image.png` with the Read tool and read `caption.txt`, `gate.json`, `validation.json` and `audit.json`. Judge them against Appendix A as a demanding editor would:
   - The hook card looks like the template description: grain barely visible, the bloom reads as a highlighter, the bottom 40% is empty.
   - The poster has no collisions, and its accent lines reframe their bodies.
   - The diagram looks like real working notes: readable at phone size, numbers scattered, arrows clear of labels.
   - The captions follow the format division of labour and contain no invented first-person facts.
3. For every failed post, read its `failure.json` and the stage logs.
4. Fix the causes in prompts, validators, gates, the runtime or the pipeline. Do not lower any rule from Appendix A to make a check pass. When a prompt is the cause, improve the prompt (you may edit files in `prompts/` and `style/`, and you must record every edit in PROGRESS.md, because they now deviate from the spec text). Add regression tests for code fixes.
5. Rerun step 1 until a run produces at least 2 ready posts out of 3 and you judge them publishable. Run at most 4 times in total. Leave the good posts in `content/posts/`. Move posts you judge unpublishable to rejected status with a reason (`status: "rejected"`, `rejectedReason`).
6. Write `docs/first-run-review.md`: per post, what you saw and what you changed.

```acceptance
# timeout-minutes: 20
npx tsx src/cli/assert-content.ts --run latest --min-ready 2 --max-age-hours 12
test -f docs/first-run-review.md
npm test
npm run typecheck
npm run lint:dashes
```
<!-- batch:M13:end -->

<!-- batch:M14:start -->
## M14. Regenerate queue, doctor, documentation, final hardening

<!-- needs: J, K, L -->

**Goal.** The finishing layer: regenerate from the app, a health check command, complete documentation, and a final pass for robustness.

**Build.**
- Regenerate queue (Appendix L1): app buttons, `queue.json`, and the runner processes the queue before new posts.
- Failed tab in the app with retry (Appendix L1).
- `src/cli/doctor.ts` and `npm run doctor` (Appendix L2).
- `README.md` complete (Appendix L3).
- Final hardening pass:
  - Run the whole test suite and the e2e tests.
  - Grep for TODO, FIXME and `any` casts in `src/` and resolve them.
  - Confirm every CLI prints `--help`.
  - Confirm `runner/run.sh --help` documents every flag.
  - Confirm all logs go under `runner/logs/`.

Lines starting with `NEXT:` below are printed by the build runner at the very end, as next steps for Gabriele. Keep them in README.md too.

NEXT: Review the first real posts: npm run app, then open http://localhost:5173
NEXT: Edit content/facts.md: add real numbers from your work and check every (VERIFY) line, the writer cannot use facts it does not have.
NEXT: Pick the diagram handwriting font: open out/bakeoff/index.html, then set diagram.handwritingFont in config.json (Kalam, Caveat or Patrick Hand SC).
NEXT: Optional: save a top-down photo of a blank notebook page as assets/notebook/page.jpg and set diagram.paper to "photo" in config.json.
NEXT: Optional: queue your own hook card phrases in content/phrase-bank.md, they are used before generated ones.
NEXT: Generate a night of posts: cd ~/linkedin-poster && bash runner/run.sh --count 12

```acceptance
# timeout-minutes: 30
npm run typecheck
npm test
npm run doctor -- --no-claude
npm run e2e
bash runner/run.sh --fake --count 2 --content-dir out/final-test --fresh --yes
npx tsx src/cli/assert-content.ts --content-dir out/final-test --ready 2
npm run lint:dashes
```
<!-- batch:M14:end -->

# Appendices

<!-- appendix:A:start -->
## Appendix A. Posting rules: style and content files

These files carry Gabriele's posting rules. They are adapted from his three Claude Project instructions (Hook Card Renderer, Editorial Poster Renderer, Notebook Diagram Prompt Generator) for unattended generation. Stage prompts include them (Appendix H), validators enforce their hard rules, and Gabriele edits the `content/` files himself.

What changed compared with the original project instructions, and why:
- The renderers moved from Python + wkhtmltoimage to TypeScript + Playwright (Chromium). The layout math is unchanged (Appendices C and D).
- In the original flow the user supplied a phrase or a topic. Here the idea stage supplies the topic, and the hook phrase comes from the phrase bank or from Opus.
- "Present the file and say nothing" became "write files to the post folder".
- "Inspect before presenting" became deterministic render gates plus a visual check in the diagram scene stage.
- The notebook diagram no longer goes through an image generation prompt. It is drawn by code (Appendix E). The image-generator banned words and the reminder to attach the notebook photo are gone.
- The caption rules were identical in all three documents. They are now one base file plus one short file per format. When a format file conflicts with the base file, the format file wins.
- First-person numbers and events must come from `content/facts.md` (claim audit, Appendix I), because unattended generation would otherwise invent them.

#### File: `style/voice.md`
~~~~markdown
# Voice and audience

## Who is writing
Gabriele Bolognese, a solo founder and developer. He builds FlashFX, a browser-based motion graphics and video editor, alone. Every post is published under his name, in first person.

## The niche
How to be a great developer in the AI era, written at operator altitude: aimed at the people who hire and fund developers, not at developers hunting tips. Every post must reflect how work actually goes, including what it costs, where it breaks, and what gets traded away. Peer-level advice ("use these 5 extensions") is out of scope.

Ground posts in FlashFX-style work (building a complex browser editor solo, with AI agents) where it is honest to do so.

## Voice
First person. Plain, direct, declarative. He is reporting what he does and what it cost him, not teaching or motivating.

Concrete beats clever. A real number beats an adjective every time, but only a real one: first-person numbers, dates, durations, results and events must come from the facts list you are given. If no fact fits, make the point without a number. Never invent statistics, studies or anecdotes.

Never write in listicle voice ("Boost your productivity with these tips").

Ban outright: "game changer", "unlock", "leverage" as a verb, "in today's fast paced world", "here's the thing", "let that sink in", "I've been thinking a lot about", and any sentence that could appear on a motivational poster. The full list is in the banned phrases you are given.

## Punctuation
Never use em dashes. Use commas, periods or parentheses. Do not use en dashes as punctuation either.
~~~~

#### File: `style/format-hook.md`
~~~~markdown
# Format: hook card

## What it is
A minimal editorial card: one sentence in EB Garamond on warm off-white paper, with a single italic phrase marked by a soft pastel highlighter bloom. 1080 x 1350. The text sits in the upper-middle third and the bottom 40% stays empty. A template fixes the design; you only decide the words, the highlight and the line breaks.

## Writing the phrase (only when no phrase is supplied)
- One sentence. A claim a reader in the audience could push back on, not a truism.
- 90 characters or fewer, counted across all lines. Shorter is better.
- The idea the sentence exists to deliver (the payload) is a noun or noun phrase near the end.
- Plain words. No question, no hashtag, no emoji, no quotation marks, no em dash.
- Not a motivational poster line. Not a cliche about "the AI era".
- When a phrase is supplied, never change a single word of it. His voice is the product.

## Design decisions you make

**1. Pick the highlighted phrase.** Exactly one per card, 1 to 4 words.

Choose the conceptual payload, the idea the whole sentence exists to deliver. It is almost always a noun or noun phrase near the end.

- "Your AI output is only as good as your **taste**"
- "The most valuable skill is knowing **what not to ship**"

Never highlight filler, a verb alone, a pronoun, or the opening words. Never highlight two separate phrases. The single accent against otherwise plain black type is the entire visual concept, and a second highlight destroys it.

**2. Break the lines.** Two or three lines, never one, never four.

- The highlighted phrase must never split across a line break. Keep it whole on one line.
- Aim for lines of roughly similar length, with the longest line first where possible. This produces the settled, book-page look.
- Break on natural grammatical joints, not wherever the width runs out.
- Every line must fit the 900 px text column at the font size the template picks; the renderer measures this. As a guide, these line lengths fit comfortably: about 20 characters at 96 px, 22 at 86 px, 25 at 74 px, 29 at 64 px. The template picks the font size from the total characters (including the 9 characters of the highlight tags): up to 40 gives 96 px, up to 60 gives 86 px, up to 85 gives 74 px, above that 64 px.

**3. Check the length.** The total across all lines must be 90 characters or fewer. Never produce an over-length phrase, because the font drops to an unreadable size.

## The fixed design (for your understanding; you never change it)
- 1080 x 1350, 4:5 portrait: maximum vertical space in the LinkedIn feed.
- Background #E9E8E4, warm off-white, never pure white. Pure white reads as a default template.
- EB Garamond, near-black #141414. An old-style serif reads as considered, not made in a social graphics tool.
- Paper grain plus a soft light bloom, subtle by design.
- Text in the upper-middle third, bottom 40% empty. A book-page composition, not a social graphic.
- A blurred pastel gradient behind the italic phrase works as a highlighter. It is the only designed element.
- No logo, no handle, no CTA, no watermark, no border, no date. The absence is the point.
~~~~

#### File: `style/format-poster.md`
~~~~markdown
# Format: editorial poster

## What it is
The highest-density format in the rotation. It exists to win dwell time: someone should need 20 seconds to read it. A giant numeral (the item count) sits in the centre with a two-line title beneath it, and 4 to 9 numbered items surround it in a three-column arrangement. Black plus one accent colour (#2F7A3E) on pure white, EB Garamond. A template fixes the design; you write all of the content.

## The number and the title
- The number is the item count.
- The title completes the phrase and must fit two short lines of 10 to 14 characters each (hard maximum 16), because it sits in a narrow 300 px centre column beneath the numeral. Longer lines wrap and break the layout.
- Write it as a personal claim, not a listicle headline. "Rules I Ship AI Code By" beats "9 Rules For Shipping AI Code".
- Good: 9 / "Rules I Ship" / "AI Code By:". Bad: "9 Essential Best Practices For Modern Development" (far too long, and generic).

## How many items
Choose 9 when the topic is rich, 6 or 7 when it is not. Never pad. Six strong items beat nine where three are filler. Supported counts are 4 to 9.

## Each item has exactly three parts
The three-part rhythm is what makes high density readable. Never drop one.

1. Title. 2 to 4 words, maximum 24 characters. Imperative or noun phrase. "Read the Diff", "Small Blast Radius".
2. Body. 1 to 2 sentences, maximum 120 characters. The substance. State what to do and why, concretely.
3. Accent line. One sentence, maximum 55 characters. The aphorism, rendered in italic accent colour. It is the line that gets screenshotted and quoted, so it carries the most weight per character.

The character limits are hard. Text over the limit overflows its block and collides with the row below. Count before answering.

## Quality bar for the set
- At least two items must name a real cost, tradeoff or failure mode (tag them "cost").
- At least one item should contain a concrete number or a specific detail from real work (tag it "concrete"). Numbers must come from the facts list.
- Every item must be arguable. If nobody could disagree, it says nothing and should be replaced.
- No item may restate another. Nine items means nine distinct ideas.
- Never invent statistics, studies or numbers you cannot stand behind.

## The accent line is where most drafts fail
It must not summarise the body. It must reframe it.
- Body: "Never merge what you have not read." Accent: "Unread code is debt with no due date."
- Weak accent: "So always read your code." That just repeats the body and wastes the highest-value line on the card.

## Voice
Write as someone reporting what he does and what it cost him. Never listicle voice. No em dashes anywhere in the poster text.
~~~~

#### File: `style/format-diagram.md`
~~~~markdown
# Format: notebook diagram

## What it is
A page of hand-drawn working notes: a system drawn in black felt-tip ink on notebook paper, with six elements numbered in yellow highlighter in a scattered reading order. Code draws it entirely (sketchy rough.js shapes, a handwriting font with per-letter jitter). No image generation model is involved. The page must read as notes found on someone's desk, not as a designed graphic. It is the deliberately rough counterpart to the two clean editorial formats in the rotation.

## Step 1: design the system
You design the actual content. The topic is only a subject; inventing a genuinely good system is your job.

- 5 to 7 conceptual elements. Fewer looks thin. More becomes illegible.
- At least one element must name a cost, a constraint, a tradeoff or a failure mode (tag it "cost" or "failure-mode"). A system with only upside reads as generic.
- At least one element must be a decision rule, something with an if/then shape (tag it "decision-rule").
- The system must be specific enough that a reader could disagree with it. If nobody could argue with it, it says nothing.
- No invented statistics. No fake numbers.
- Operator altitude: how the work actually goes, what it costs, where it breaks, what gets traded away.

## Step 2: the visual grammar
Give every element a kind. Shape variety is what makes the page read as real working notes instead of a flowchart. Never put everything in boxes: use at least 4 different kinds, and at most one bigBox.

| Element type | kind | How it is drawn |
|---|---|---|
| Stages of a process, or components of one named group | pill | hand-drawn ovals or pills, chained with short arrows or stacked |
| The single largest entity or end outcome | bigBox | large rounded rectangle |
| Anything tiered, levelled or in ascending order | threeCol | a box split into three labelled columns, with the element label above it |
| A set of sub-items under one heading | bracket | heading, hand-drawn curly bracket, 2 or 3 items beneath |
| An output or artifact | icon | a crude hand-drawn icon with the label under it. Icons: envelope, dollar, chart, clock, file, gear, warning, code, person, bolt, check, flag |
| A principle or constant that governs everything | circleWord | one word or a short phrase inside a circle |
| A plain note | plain | hand-lettered text with no shape, usually the target of an arrow |
| A phase transition or flow | wavyLines | several wavy parallel vertical lines, no label (a decoration, not an element) |
| Any dependency or sequence | edges | hand-drawn curved arrows between elements |

## Step 3: labels
- Every label is ALL CAPS.
- Every label is 1 to 3 words. Never a sentence.
- Total text elements on the page, including the title, the three column headings of a threeCol and every bracket item: maximum 14. Count them.
- The title is 3 to 5 words, all caps, at the top centre.
- No punctuation inside labels. Column headings are separate strings.

These limits keep the page readable at phone size.

## Step 4: numbering
Six elements carry the numbers 1 to 6, each circled in yellow highlighter. The numbers set the reading order.

The reading order must NOT run in simple left-to-right or top-to-bottom order. Scatter the numbers across the page the way real notes do: for example number 1 lower right, number 2 upper right, number 3 upper left. This is deliberate. It is what makes the page look found rather than designed.

## Step 5: layout (the scene stage)
- Canvas 1080 x 1350. Keep everything inside the safe area: x from 60 to 1020, y from 60 to 1290.
- The title sits at the top centre (about y 110). Elements start below y 200.
- Use the whole page. The drawn content should span at least 70% of the width and 60% of the height. Do not cluster everything in the middle.
- Think in a loose grid of about 3 columns and 4 rows, then break it: offset elements, vary their sizes, avoid perfect alignment.
- Keep at least 40 px of clear paper around every label.
- Arrows curve gently (bend between 0.1 and 0.35), connect the nearest sides, and never pass through a label.
- A highlighter number sits on a corner of its element, never on top of the label text.
- The bigBox, if any, gets the most space. Bracket items need vertical room.

## The fixed look (the runtime sets it; scenes never change it)
Paper (dot grid, ruled, squared, or Gabriele's notebook photo), near-black ink with a slight wobble, the handwriting font, the yellow highlighter, a slight overall tilt. Scenes only place elements.

## Meaning lines
Every element has a one-line plain-English meaning. They are stored with the post as "SYSTEM SHOWN" for Gabriele's reference and never drawn.
~~~~

#### File: `style/caption-base.md`
~~~~markdown
# LinkedIn caption: base rules (all formats)

The caption is the text of the post. The image is attached separately. A format-specific rules file follows this one. When a format rule conflicts with a base rule, the format rule wins.

## Structure
1. HOOK. One line. Maximum 140 characters.
   LinkedIn truncates on mobile at roughly 140 to 210 characters behind a "see more". The hook must land a complete, provocative idea before that cut, and it must make no sense to stop reading. Never open with a greeting, a throat-clear, or "I want to share".
2. Blank line.
3. SETUP. One to three short lines. State the tension, the mistake, or the situation. This is where the reader decides to keep going.
4. Blank line.
5. THE LIST. Three to seven items, one line each, no wrapping. Prefix each with "→ " or nothing. Never use hyphens or asterisks as bullets. Each item must be a complete thought, not a fragment.
6. Blank line.
7. THE PAYOFF. One or two lines. The thing the list adds up to. This is the line people quote, so it carries the most weight per character.
8. Blank line.
9. CTA. One genuine question that a reader could answer from their own experience. It must be answerable in a sentence. It is always the last line.

## Hard rules
- EXACTLY ONE EMOJI in the entire caption. Not zero, not two. Place it at the start of one single list item (right after the "→ " when the list uses arrows), the most important one, so it works as a visual anchor in a wall of text. Never in the hook. Never a face emoji. Use a plain object or symbol.
- NO EM DASHES anywhere. Use commas, periods or parentheses.
- NO LINKS. Not in the body, not "link in comments". External links cost roughly 60% of reach, and the first-comment workaround was closed in early 2026. If something needs a link, Gabriele adds it manually later.
- NO ENGAGEMENT BAIT. Never "Agree?", "Comment YES", "Thoughts?", "Repost if you found this useful", "Follow for more". These are actively suppressed now, and they read as desperate to the exact buyers he wants.
- NO HASHTAGS. The ranking system reads the actual words of the post. Put the real keywords in the sentences instead.
- ONE IDEA PER LINE, and use blank lines generously. Dense paragraphs kill dwell time on mobile.

## Voice
First person. Plain, direct, declarative. He is reporting what he does and what it cost him, not teaching or motivating.

Ban outright: "game changer", "unlock", "leverage" as a verb, "in today's fast paced world", "here's the thing", "let that sink in", "I've been thinking a lot about", any sentence that could appear on a motivational poster.

He is a solo founder building FlashFX, a browser-based motion graphics and video editor. Written for the people who hire and fund developers, not for developers collecting tips. Concrete beats clever. A real number beats an adjective every time, and first-person numbers must come from the facts list.

## Keywords
Work the topic's real vocabulary into the sentences naturally. Candidate retrieval for people outside his network runs on a text embedding of the post and his profile, so the specific nouns of his field are what place the post near the right strangers. Write the words a practitioner would actually use.

## Before you answer
Check, in order: hook under 140 characters, exactly one emoji, zero em dashes, zero links, zero hashtags, no banned phrases, CTA is a real question and the last line, length inside the format's range. Fix anything that fails before answering.
~~~~

#### File: `style/caption-hook.md`
~~~~markdown
# Caption rules: hook card

Target 900 to 1300 characters. This is the long one.

The image contains a single sentence, so the caption carries all of the substance. Do not restate the phrase from the image as your hook. The image already said it. Open on the next beat instead: the reason it is true, the cost of ignoring it, or the moment it became obvious. (Checked automatically: the hook line must not contain the highlighted phrase and must not share five consecutive words with the image phrase.)

This format is aimed at comments rather than saves, so the list should be opinions or observations that a reader can push back on, not steps in a process.
~~~~

#### File: `style/caption-poster.md`
~~~~markdown
# Caption rules: editorial poster

Target 400 to 700 characters. This is the short one, and shortest is usually best.

The image already contains every item in full. DO NOT repeat, summarise or paraphrase the items in the caption. If the caption duplicates the poster, the reader has no reason to read either one, and dwell time collapses. (Checked automatically: no item title, no accent line, and no five consecutive words from any item body may appear in the caption.)

The caption's only job is to make the image worth studying. Give the origin of the list: what happened that produced these rules, or what it cost to learn them. Then point at the image.

The list section is two or three lines here (this overrides the base rule of three to seven items), and it must be about the list, not from it. For example: what changed after adopting these, or which one he still gets wrong.
~~~~

#### File: `style/caption-diagram.md`
~~~~markdown
# Caption rules: notebook diagram

Target 600 to 900 characters.

The image shows the structure. The caption supplies what a diagram cannot: why the system exists, what it replaced, and what it costs to run. Walk the numbered elements briefly, one per list line, in the order the yellow numbers set: six list lines, each naming its element. (Checked automatically: every numbered label appears in the caption, in number order.)

Include at least one line about where the system breaks or what it trades away. A system with only upside reads as invented.

Name the diagram so the reader knows the two halves belong together, for example "Full system in the image." Put that line in the payoff, right before the CTA. The CTA question stays the last line.
~~~~

#### File: `style/banned-phrases.txt`
~~~~text
# One phrase per line, case-insensitive. Lines starting with # are comments.
# Matched as whole words or phrases in captions and in all image text.
game changer
game-changer
unlock
unlocks
unlocking
leverage
leveraging
leveraged
in today's fast paced world
in today's fast-paced world
fast-paced world
here's the thing
let that sink in
i've been thinking a lot about
i want to share
delve
tapestry
supercharge
revolutionize
next level
level up
the future is here
buckle up
# engagement bait
agree?
thoughts?
comment yes
repost if
follow for more
like if you
tag someone
drop a comment
let me know in the comments
link in comments
link in the comments
~~~~

#### File: `content/pillars.md`
~~~~markdown
# Content pillars

Niche: how to be a great developer in the AI era, at operator altitude (for the people who hire and fund developers).

The idea stage rotates through these pillars and never uses the same pillar twice in a row. Edit freely; keep the numbering.

1. Delegation and verification: what to hand to agents, what to keep, how to check the output.
2. Cost and failure modes of AI-assisted development: where it breaks, what it really costs.
3. Taste and judgment: deciding what not to build and what not to ship.
4. Building solo with agents: lessons from building FlashFX alone.
5. Automation and agent workflows: unattended runs, review loops, runners, seen from the operator's side.
6. Hiring and working with developers in the AI era: what changed for the people paying for software.

Out of scope: tool lists, extension roundups, prompt tricks, motivational content, news recaps.
~~~~

#### File: `content/facts.md`
~~~~markdown
# Facts bank

The writer may only state first-person numbers, dates, durations, results, names and events that appear here. Everything else must be said without them.

Format: one fact per line, starting with "- [F##] ". Lines containing "(VERIFY)" are ignored until you remove the marker. Add real numbers from your work: they are what make posts concrete.

## Work
- [F01] I am a solo founder and developer building FlashFX, a browser-based, editor-first motion graphics and video editor.
- [F02] I build FlashFX alone, with no outside investors.
- [F03] I have been building FlashFX since mid-2025.
- [F04] Claude Code is my primary AI coding agent.
- [F05] I run unattended overnight Claude Code automations from Git Bash scripts; when a step fails, an Opus reviewer writes a fix file, another model applies it, and the run restarts.
- [F06] I won the Gara Nazionale di Informatica 2026, the Italian national computer science championship for technical high schools, held in May 2026 in Moncalieri.
- [F07] I founded Render Journal, an independent publication that benchmarks creative software.
- [F08] Two earlier products of mine, an ML education platform and an AI workflow platform, are deprecated.
- [F09] I applied to Y Combinator with FlashFX three times and was rejected each time. (VERIFY)
- [F10] This LinkedIn pipeline itself was built overnight, batch by batch, by a runner that drives headless Claude Code. (VERIFY)

## Numbers
(add measured numbers here, for example: build times, bundle size, lines of code, hours saved per week, bugs caught by review)
~~~~

#### File: `content/phrase-bank.md`
~~~~markdown
# Hook card phrase bank

Write your own hook card phrases under "Queue", one per line, starting with "- ". Each hook card uses the first queued phrase exactly as written (90 characters max), and the runner moves it under "Used" with the post id. When the queue is empty, Opus writes the phrase.

## Queue

## Used
~~~~

**Facts format, for `src/pipeline/facts.ts`:** a usable fact is a line matching `^- \[(F\d{2,3})\] (.+)$` that does not contain `(VERIFY)`. The prompt facts block lists usable facts as `[F01] text`, one per line. If there are none, the block says `(no facts available: make every point without first-person numbers, dates or events)`.

<!-- appendix:A:end -->

<!-- appendix:B:start -->
## Appendix B. Rendering foundation

### B1. Fonts

`scripts/copy-fonts.ts` copies these files from `node_modules/@fontsource/<pkg>/files/` into `assets/fonts/`. Use the `latin` subset (not `latin-ext`). If an exact source name is missing in the installed version, find it by globbing `files/*-latin-<weight>-<style>.woff2` and fail with a clear message if nothing matches.

| Family (CSS) | Package | Weight | Style | Target file |
|---|---|---|---|---|
| EB Garamond | eb-garamond | 400 | normal | `eb-garamond-400-normal.woff2` |
| EB Garamond | eb-garamond | 400 | italic | `eb-garamond-400-italic.woff2` |
| EB Garamond | eb-garamond | 700 | normal | `eb-garamond-700-normal.woff2` |
| EB Garamond | eb-garamond | 700 | italic | `eb-garamond-700-italic.woff2` |
| Kalam | kalam | 400 | normal | `kalam-400-normal.woff2` |
| Kalam | kalam | 700 | normal | `kalam-700-normal.woff2` |
| Caveat | caveat | 400 | normal | `caveat-400-normal.woff2` |
| Caveat | caveat | 700 | normal | `caveat-700-normal.woff2` |
| Patrick Hand SC | patrick-hand-sc | 400 | normal | `patrick-hand-sc-400-normal.woff2` |

Also copy each package's `LICENSE` file to `assets/fonts/licenses/<pkg>.txt` (all are SIL Open Font License).

`src/render/fonts.ts` exports this table and `fontFaceCss(refs)`, which produces:

```css
@font-face{font-family:'EB Garamond';font-style:italic;font-weight:400;font-display:block;src:url(http://lp.local/fonts/eb-garamond-400-italic.woff2) format('woff2');}
```

### B2. `src/render/browser.ts`

```ts
export interface RenderOptions {
  html: string;
  width: number;
  height: number;
  out?: string;                          // PNG path to write (directories created)
  routes?: Record<string, string>;       // extra URL prefixes under http://lp.local/ mapped to absolute directories
  waitForFunction?: string;              // JS expression; rendering waits until it is truthy
  waitTimeoutMs?: number;                // default 20000
  measure?: string;                      // JS function source "() => {...}", evaluated after ready; its JSON result is returned
  requiredFonts?: { family: string; weight: number; style: "normal" | "italic" }[];
}
export interface RenderResult {
  png: Buffer;
  measurements: unknown;
  fonts: { family: string; weight: number; style: string; loaded: boolean }[];
  consoleErrors: string[];
}
export function getBrowser(): Promise<Browser>;
export function closeBrowser(): Promise<void>;
export function renderHtml(opts: RenderOptions): Promise<RenderResult>;
```

How rendering works:
1. One Chromium instance per process (`chromium.launch({ headless: true })`), closed on `process.on('exit')`, `SIGINT` and `SIGTERM`.
2. Each render gets a new context with `viewport: { width, height }` and `deviceScaleFactor: 1`.
3. **Virtual origin.** `page.route('http://lp.local/**', ...)` serves:
   - `/__page.html`: the HTML of this render.
   - `/fonts/*`: from `assets/fonts/`.
   - `/assets/*`: from `assets/`.
   - `/runtime/*`: from `out/runtime/`.
   - Each extra prefix in `routes`.
   
   Missing files get a 404 and a recorded console error. Content types come from the extension (`.woff2` font/woff2, `.js` text/javascript, `.png` image/png, `.jpg` image/jpeg, `.css` text/css, `.json` application/json, `.html` text/html). Then `page.goto('http://lp.local/__page.html', { waitUntil: 'load' })`. Everything is same-origin, so there are no CORS problems with fonts or canvas reads.
4. Collect `console` messages of type error and `pageerror` events.
5. Wait for `document.fonts.ready`. For each `requiredFonts` entry, call `document.fonts.load('<style> <weight> 40px "<family>"')`, then report `loaded` by checking that a FontFace with that family, weight and style exists in `document.fonts` with status `loaded`. Do not rely on `document.fonts.check()`: it returns true for families that are not defined at all.
6. If `waitForFunction` is set, `page.waitForFunction(expr, null, { timeout })`.
7. If any page error happened, reject with `render failed: <first page error>`.
8. Evaluate `measure` if given.
9. `page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } })`, write to `out` if given, close the context.

### B3. `src/render/pixels.ts`

`sampleRegions(png: Buffer, regions: {x,y,w,h}[]) -> { r, g, b, saturation }[]`: opens a page on the virtual origin that loads the PNG from `/__sample.png` into a canvas and returns, per region, the mean of each channel (0 to 255) and the mean HSL saturation (0 to 1). No PNG library is needed.

### B4. Measurement helpers (browser side)

Measurement functions are plain JS strings evaluated in the page. They return plain JSON: boxes as `{ x, y, w, h }` in CSS pixels. To measure text extents, use a `Range` over the element's contents and union its `getClientRects()`. To detect wrapping of an inline element, count its client rects. The Node side never sees DOM objects.

<!-- appendix:B:end -->

<!-- appendix:C:start -->
## Appendix C. Hook card renderer

### C1. Content schema (`HookCardSchema`)

```ts
{
  phrase: string;        // the full sentence, plain text
  lines: string[];       // 2 or 3 lines; exactly one <hl>...</hl> pair across them
  highlight: string;     // the text inside the tags
  fromBank: boolean;     // true when the phrase came from content/phrase-bank.md (default false)
}
```

### C2. Validator (`validateCard(card, cfg, banned, expectedPhrase?)`)

Returns `{ issues: Issue[], warnings: Issue[] }`, where `Issue = { code, message, detail? }`. Messages are written for the model to read and act on (for example `line 2 has leading or trailing spaces`).

| Code | Rule |
|---|---|
| `line-count` | 2 or 3 lines |
| `hl-count` | exactly one `<hl>` and one `</hl>` in total, both on the same line, open before close, non-empty inside |
| `hl-mismatch` | the text between the tags equals `highlight` |
| `hl-words` | `highlight` has 1 to 4 words |
| `hl-opening` | the highlight must not include the first or the second word of the phrase |
| `hl-pronoun` | the highlight is not a single pronoun (I, me, you, he, him, she, her, it, we, us, they, them, this, that, these, those, my, your, our, their) |
| `text-mismatch` | the visible text (tags removed, lines joined with one space, spaces normalised) equals `phrase` |
| `too-long` | visible characters (sum of visible line lengths) at most `cfg.hook.maxChars` (90) |
| `bank-changed` | when `expectedPhrase` is given, `phrase` equals it exactly |
| `dash` | no U+2014, U+2013 or U+2015 |
| `emoji` | no emoji (same detector as Appendix F3) |
| `hashtag` | no `#` |
| `quote` | no double quotes (straight or curly) |
| `question` | the phrase does not end with `?` |
| `link` | no URL (Appendix F2 pattern) |
| `banned` | no banned phrase |
| `whitespace` | no line with leading or trailing spaces or double spaces |

Warnings (never block): `longest-not-first` (a later line is visibly longer than the first by more than 3 characters), `weak-break` (a line other than the last ends with one of: the, a, an, of, to, in, on, for, with, and, or, but, is, are, my, your).

### C3. Template (`src/render/hook/template.ts`)

Port of the tuned Python renderer. The layout numbers are identical. The differences: fonts come from local files, each line is wrapped in a `span.ln` (inline, so the layout is unchanged) for measuring, text is HTML-escaped, `.txt` gets `z-index:2`, and the grain is greyscale with its opacity calibrated for Chromium.

```ts
export const HOOK_W = 1080;
export const HOOK_H = 1350;

export function hookLayout(lines: string[]) {
  // chars counts the raw line strings INCLUDING the 9 characters of "<hl></hl>",
  // exactly like the tuned original, so font sizes match it.
  const chars = lines.reduce((n, l) => n + l.length, 0);
  const fs = chars <= 40 ? 96 : chars <= 60 ? 86 : chars <= 85 ? 74 : 64;
  const top = lines.length <= 2 ? 300 : 260;
  return { chars, fs, top };
}

// renderLine: HTML-escape everything outside the tags, then replace
// "<hl>X</hl>" with '<span class="hl"><span class="bloom"></span>X</span>' (X escaped too).
export function hookCardHtml(lines: string[], opts: { grainOpacity: number }): string {
  const { fs, top } = hookLayout(lines);
  const body = lines.map(l => `<span class="ln">${renderLine(l)}</span>`).join("<br>\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${fontFaceCss([EBG_400, EBG_400_ITALIC])}
html,body{margin:0;padding:0;width:${HOOK_W}px;height:${HOOK_H}px;overflow:hidden;}
body{background:#E9E8E4;font-family:'EB Garamond','Linux Libertine O',serif;}
.vig{position:absolute;top:0;left:0;width:${HOOK_W}px;height:${HOOK_H}px;
 background:radial-gradient(ellipse 80% 70% at 50% 38%,rgba(255,255,255,.55),rgba(255,255,255,0) 75%);}
.grain{position:absolute;top:0;left:0;width:${HOOK_W}px;height:${HOOK_H}px;opacity:${opts.grainOpacity};
 background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='5'/><feColorMatrix type='saturate' values='0'/></filter><rect width='260' height='260' filter='url(%23n)' opacity='0.5'/></svg>");}
.txt{position:absolute;z-index:2;top:${top}px;left:90px;width:900px;text-align:center;
 font-size:${fs}px;line-height:1.2;color:#141414;letter-spacing:-.005em;}
.hl{position:relative;font-style:italic;display:inline-block;padding:0 4px;}
.bloom{position:absolute;left:-26px;right:-26px;top:8px;bottom:2px;z-index:-1;
 background:linear-gradient(90deg,#93b9ee,#c6a2e6,#f0a2b6,#f2d98f,#a6dc9e);
 -webkit-filter:blur(24px);filter:blur(24px);}
</style></head><body>
<div class="vig"></div><div class="grain"></div>
<div class="txt">${body}</div></body></html>`;
}
```

**Grain calibration (do it once in M03).** wkhtmltoimage most likely ignored the SVG noise, which explains the original opacity of .85. Chromium renders it. Start from `grainOpacity = 0.22` and greyscale noise (the `feColorMatrix` above), render the `taste` fixture, and look at it with the Read tool. The texture must only be noticeable on close inspection: "if you can clearly see the texture, it is too strong". Tune only this opacity, keep it in `src/render/hook/template.ts` as `DEFAULT_GRAIN_OPACITY`, and record the value in PROGRESS.md. The `grain` gate check (C4) must pass at the chosen value.

**Why `z-index:2` on `.txt`.** The bloom must read as a highlighter behind the italic phrase. Making `.txt` a stacking context keeps the bloom above the vignette and grain overlays and behind the text. If reference PNGs exist (C6) and show a fainter bloom, compare both variants and keep the one that matches the reference. Record the decision in PROGRESS.md.

### C4. Gate (`src/render/hook/gate.ts`)

Measurement (browser) returns:
- `txt`: the `.txt` box.
- `fontSize`.
- `lines`: for each `.ln`, the number of client rects and the rendered width.
- `naturalWidths`: the width of each line laid out with `white-space: nowrap`, measured on a temporary clone that is then removed.
- `hl`: the `.hl` box.
- `fonts`: from `renderHtml`.

Then `sampleRegions(png, [{ x: 40, y: 1150, w: 300, h: 150 }])` measures the empty bottom-left corner (outside the vignette).

`judgeHookGate(m, card)` returns `{ pass, issues }`:

| Code | Fails when |
|---|---|
| `fonts` | EB Garamond 400 normal or 400 italic is not loaded |
| `wrap` | any `.ln` has more than one client rect, or `round(txt.h / (fontSize * 1.2))` differs from the number of lines |
| `width` | any natural line width is above 900 (detail lists the line index and width, for repair messages: `line 1 is 1243 px wide at 86 px, the column is 900 px`) |
| `bottom` | `txt.y + txt.h` is above 810 (the bottom 40% must stay empty) |
| `size` | the PNG is not 1080 x 1350 |
| `grain` | the bottom-left sample differs from `#E9E8E4` by more than 14 on any channel, or its saturation is above 0.08 |

### C5. Line-break rescue (`src/render/hook/linebreak.ts`)

Used when the gate fails with only `wrap` and/or `width` issues.

1. Tokenise the visible phrase into words, keeping the highlighted words as one atomic token.
2. Enumerate every split into 2 lines and into 3 lines at word boundaries.
3. For each candidate, rebuild the lines with the `<hl>` tags around the atomic token, compute `hookLayout`, and measure each line's natural width in the browser at that font size. Use one page with a canvas, `ctx.font = '<style> 400 <fs>px "EB Garamond"'`, the highlight measured in italic plus 8 px of padding. Measure all candidates in a single evaluate call.
4. A candidate is valid when every line is at most 880 px wide (20 px safety margin) and `top + lines * fs * 1.2` is at most 810.
5. Score each valid candidate (lower is better):
   - 100 times the coefficient of variation of the line widths
   - plus 15 if the first line is not the longest
   - plus 20 for each line other than the last that ends with a weak word (C2 list)
   - minus 10 for each break right after a comma
   - plus 5 for 3 lines
   - plus 8 for each break position that differs from the model's original breaks
6. Return the best candidate's lines, or null when nothing is valid. Then the pipeline sends the model back a repair message saying the phrase is too long to fit and must be shortened.

### C6. Calibration CLI (`npm run calibrate`)

Renders the `taste` and `what-not-to-ship` fixtures into `out/calibration/`. If `assets/reference/hook-*.png` files exist, it writes `out/calibration/compare.html` showing each reference next to the new render at the same scale. It never fails. Gabriele can drop PNGs rendered by his original Claude Project into `assets/reference/` at any time. The same CLI handles `assets/reference/poster-*.png` after M04.

### C7. Fixtures

#### File: `tests/fixtures/hook/taste.json`
~~~~json
{
  "phrase": "Your AI output is only as good as your taste",
  "lines": ["Your AI output is only", "as good as your <hl>taste</hl>"],
  "highlight": "taste",
  "fromBank": false
}
~~~~

#### File: `tests/fixtures/hook/what-not-to-ship.json`
~~~~json
{
  "phrase": "The most valuable skill is knowing what not to ship",
  "lines": ["The most valuable skill", "is knowing", "<hl>what not to ship</hl>"],
  "highlight": "what not to ship",
  "fromBank": false
}
~~~~

#### File: `tests/fixtures/hook/rescue.json`
~~~~json
{
  "phrase": "The most valuable skill is knowing what not to ship",
  "lines": ["The most valuable skill is knowing", "<hl>what not to ship</hl>"],
  "highlight": "what not to ship",
  "fromBank": false
}
~~~~

`rescue` is valid content, but its first line is far wider than 900 px at 86 px. It must fail the gate, be rescued, and then pass.

<!-- appendix:C:end -->

<!-- appendix:D:start -->
## Appendix D. Editorial poster renderer

### D1. Content schema (`PosterContentSchema`)

```ts
{
  number: string;                 // equals String(items.length)
  title_line1: string;
  title_line2: string;
  items: {
    n: string;                    // "1".."9", sequential
    title: string;
    body: string;
    accent_line: string;
    tags: ("cost" | "concrete")[];   // default []; not rendered
  }[];                            // 4..9 items
}
```

The accent colour, footer and output path come from `config.json`, not from the model.

### D2. Validator (`validatePoster(poster, cfg, banned)`)

| Code | Rule |
|---|---|
| `count` | 4 to 9 items |
| `number` | `number === String(items.length)` |
| `item-n` | `items[i].n === String(i + 1)` |
| `title-line-length` | each title line has 1 to 16 characters (warning above 14) |
| `item-title-length` | item title at most 24 characters |
| `item-title-words` | item title has 2 to 4 words |
| `body-length` | body has 1 to 120 characters |
| `accent-length` | accent line has 1 to 55 characters |
| `cost-tags` | at least 2 items tagged `cost` |
| `duplicate` | no two item titles or accent lines are equal (case-insensitive), and no two bodies have a content-word Jaccard similarity above 0.6 |
| `accent-repeats-body` | an accent line shares 60% or more of its content words with its own body (content words: lowercase tokens of 3 or more letters, minus a stopword list) |
| `dash`, `emoji`, `hashtag`, `link`, `banned` | as in C2, applied to every text field |

Warning: `concrete-tag` (no item tagged `concrete`).

### D3. Template (`src/render/poster/template.ts`)

Port of the tuned Python renderer, with the same numbers. All text is HTML-escaped. The fonts come from local files.

```ts
const LAYOUT: Record<number, [number, number]> = { 4: [0, 2], 5: [1, 2], 6: [2, 2], 7: [3, 2], 8: [2, 3], 9: [3, 3] };
export const POSTER_W = 1080;
const COLW = 300, LX = 34, RX = 746, TOPY = 55, ROW_GAP = 300;

export function posterLayout(n: number, hasFooter: boolean) {
  const [topN, sideRows] = LAYOUT[n];
  const firstRow = topN ? 360 : 90;
  const rowY = Array.from({ length: sideRows }, (_, i) => firstRow + i * ROW_GAP);
  const lastEnd = rowY[rowY.length - 1] + 210;
  const height = lastEnd + (hasFooter ? 120 : 70);
  const numTop = rowY[0] - 40;
  const topXs = ({ 0: [], 1: [390], 2: [LX, RX], 3: [LX, 390, RX] } as Record<number, number[]>)[topN];
  // positions: first the top items at (x, TOPY, width 300), then rows left-right at (LX|RX, y, COLW)
  return { topN, sideRows, rowY, height, numTop, topXs };
}
```

Heights this must produce:

| Items | Top items | Side rows | Height with footer | Height without |
|---|---|---|---|---|
| 4 | 0 | 2 | 720 | 670 |
| 5 | 1 | 2 | 990 | 940 |
| 6 | 2 | 2 | 990 | 940 |
| 7 | 3 | 2 | 990 | 940 |
| 8 | 2 | 3 | 1290 | 1240 |
| 9 | 3 | 3 | 1290 | 1240 |

HTML (same CSS as the original, plus `@font-face` for EB Garamond 400, 400 italic and 700):

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><style>
/* fontFaceCss(EBG 400, 400 italic, 700) */
html,body{margin:0;padding:0;width:1080px;height:{H}px;overflow:hidden;}
body{background:#FFFFFF;font-family:'EB Garamond','Linux Libertine O',serif;color:#111;}
.it{position:absolute;text-align:center;}
.n{font-size:19px;color:#111;margin-bottom:5px;
 border:1.4px solid #111;border-radius:50%;width:30px;height:30px;line-height:29px;
 display:inline-block;}
.t{font-size:26px;font-weight:700;line-height:1.16;margin-bottom:9px;}
.b{font-size:16.5px;line-height:1.42;color:#1a1a1a;}
.a{font-size:15.5px;line-height:1.4;font-style:italic;color:{ACCENT};margin-top:9px;}
.big{position:absolute;left:0;top:{numTop}px;width:1080px;text-align:center;
 font-size:230px;line-height:.86;font-weight:700;letter-spacing:-.02em;}
.cap{position:absolute;left:390px;top:{numTop+205}px;width:300px;text-align:center;
 font-size:44px;line-height:1.08;font-weight:700;}
.foot{position:absolute;left:0;bottom:34px;width:1080px;text-align:center;
 font-size:18px;color:#333;border-top:1.4px solid #ddd;padding-top:22px;}
</style></head><body>
{items: <div class="it" style="left:{x}px;top:{y}px;width:{w}px"><div class="n">{n}</div><div class="t">{title}</div><div class="b">{body}</div><div class="a">{accent_line}</div></div>}
<div class="big">{number}</div>
<div class="cap">{title_line1}<br>{title_line2}</div>
{footer ? <div class="foot">{footer}</div> : ""}
</body></html>
```

The footer's double spaces collapse in HTML, exactly as in the original. Keep it that way.

### D4. Gate (`src/render/poster/gate.ts`)

Measurement returns the box of every `.it`, with its row (`top` or the side row index) and column, the number of lines of each `.t` (height divided by 26 times 1.16, rounded), the `.cap` box and its line count (height divided by 44 times 1.08, rounded), the `.foot` box if any, `numTop`, the canvas height and the fonts.

`judgePosterGate(m)`:

| Code | Fails when |
|---|---|
| `fonts` | EB Garamond 400, 400 italic or 700 not loaded |
| `overlap` | any two item boxes, or the cap and any item box, intersect after growing each box by 6 px |
| `numeral-collision` | a top-row item's bottom is below `numTop + 10` |
| `title-wrap` | the cap does not have exactly 2 lines |
| `item-title-wrap` | an item title has more than 2 lines |
| `footer` | with a footer, an item's bottom is within 12 px of the footer top (or past it) |
| `bounds` | any item's bottom is below the canvas height minus 20 |
| `size` | the PNG is not 1080 x the computed height |

The numeral is not tested with text rects: its line box (line-height .86) is smaller than its glyph area, so a Range rect would report false collisions. With fixed positions and a single digit, the numeral can only collide with top-row items, and `numeral-collision` covers that case.

### D5. Fixture

#### File: `tests/fixtures/poster/items-9.json`
~~~~json
{
  "number": "9",
  "title_line1": "Rules I Ship",
  "title_line2": "AI Code By:",
  "items": [
    { "n": "1", "title": "Read the Diff", "body": "Never merge what you have not read. Generated code compiles and still encodes the wrong assumption.", "accent_line": "Unread code is debt with no due date.", "tags": ["cost"] },
    { "n": "2", "title": "Small Blast Radius", "body": "One agent task touches one module. When it breaks, I know where to look and what to revert.", "accent_line": "Scope is the cheapest test you will ever write.", "tags": [] },
    { "n": "3", "title": "Tests Before Trust", "body": "I write the failing test first, then let the agent chase it. Green means done, looks right does not.", "accent_line": "A passing test is a contract. A vibe is not.", "tags": [] },
    { "n": "4", "title": "Own the Interfaces", "body": "I design the types and APIs by hand. Agents fill in function bodies, never the boundaries.", "accent_line": "Whoever owns the seams owns the system.", "tags": [] },
    { "n": "5", "title": "Keep the Prompt", "body": "Every merged change keeps the prompt that produced it, so a bad pattern can be traced back.", "accent_line": "Code without its prompt is a fossil.", "tags": [] },
    { "n": "6", "title": "Restart Long Sessions", "body": "When a session drifts, I stop, write a short summary, and start fresh instead of arguing with it.", "accent_line": "Context rots faster than code does.", "tags": [] },
    { "n": "7", "title": "Pay the Review Tax", "body": "Reviewing generated code costs real time every day. I budget for it instead of pretending it is free.", "accent_line": "Free code is the most expensive kind.", "tags": ["cost"] },
    { "n": "8", "title": "No Silent Dependencies", "body": "Agents add packages to solve small problems. I reject any dependency I would not add by hand.", "accent_line": "Every package is a stranger with commit access.", "tags": ["cost"] },
    { "n": "9", "title": "Ship Then Measure", "body": "I ship behind a flag and watch real usage before polishing. Agents make polish cheap, not useful.", "accent_line": "Polish what people touch, not what you see.", "tags": [] }
  ]
}
~~~~

The `bad-overflow` fixture is generated in code: `items-9` with item 4's body (the first left item of the side rows) replaced by a 420-character text. It is used only in tests and `render:fixtures`, and it must fail the gate with `overlap` (the block grows into the row below). The content validator would also reject it; tests call the renderer directly.

<!-- appendix:D:end -->

<!-- appendix:E:start -->
## Appendix E. Notebook diagram renderer (2D, drawn by code)

This replaces the original image-generation prompt. A diagram is a short **scene script** written by Opus. It calls drawing primitives with coordinates. A fixed browser runtime draws them with rough.js (sketchy shapes), a handwriting font with per-glyph jitter, a felt-tip ink effect and a yellow highlighter, and records the geometry of everything it drew so a gate can judge the layout. The runtime fixes the look. The scene only decides composition.

### E1. Files

```
src/render/diagram/runtime/
  index.ts        # window.scene(), window.__runScene(), builds the API, error capture, ready flag
  paper.ts        # paper modes (CSS applied to #paper)
  ink.ts          # rough.js wrapper bound to the ink and highlighter layers, wobble filter, tilt group
  lettering.ts    # jittered hand-lettering as SVG text with one tspan per glyph
  primitives.ts   # title, pill, chain, bigBox, threeCol, bracket, icon, circleWord, wavyLines, plain, arrow, marker
  icons.ts        # 12 crude icons drawn with rough.js
  registry.ts     # window.__diagram geometry registry
  rng.ts          # mulberry32 + per-element seeds
src/render/diagram/bundle.ts     # esbuild bundling to out/runtime/diagram-runtime.js, ensureRuntime()
src/render/diagram/shell.ts      # the HTML page that hosts the runtime and the scene
src/render/diagram/render.ts     # renderDiagram()
src/render/diagram/validate.ts   # validateDiagramSpec()
src/render/diagram/gate.ts       # measurement is the registry itself; judgeDiagramGate()
```

### E2. Page structure and paper

Canvas 1080 x 1350. Layers, bottom to top:

1. `#paper`: a div filling the canvas, styled by the paper mode.
2. `svg#hl` (1080 x 1350): the highlighter layer, `mix-blend-mode: multiply`.
3. `svg#ink` (1080 x 1350): the ink layer, `mix-blend-mode: multiply`, `opacity: .94`, the wobble filter applied to its main group.
4. `#grain`: noise overlay at opacity 0.18, the same greyscale SVG noise as the hook card. Not used in photo mode.

Both SVGs contain a group rotated by `tiltDeg` around (540, 675). `tiltDeg` is drawn from the seed in `[-maxTiltDegrees, +maxTiltDegrees]` (config, default 1.2). All registry geometry is in scene coordinates (before tilt). The safe-area margin absorbs the tilt.

Paper modes (`config.diagram.paper`):

| Mode | Look |
|---|---|
| `dots` (default) | background `#F2EFE6`; dot grid `radial-gradient(circle, #C9C3B3 1.6px, transparent 1.9px)` at 36 px spacing, offset 18 px |
| `ruled` | background `#F4F1E8`; horizontal rules `#BCCBDA` 1.5 px every 44 px starting at y 140; a red margin line `#E3A3A3` 1.5 px at x 110 |
| `grid` | background `#F3F2EC`; squares of `#D6DAE0` 1 px lines at 36 px |
| `photo` | `<img>` of `config.diagram.photo.file` (served under `/assets/`) with `object-fit: cover` over the canvas. Both SVG layers are positioned and scaled into `photo.drawArea` with `viewBox="0 0 1080 1350"`, so scene coordinates stay the same. No grain overlay. If the file is missing, fall back to `dots` and add a warning to the registry. |

Non-photo modes also get `box-shadow: inset 0 0 140px rgba(60, 40, 10, .10)` on `#paper`, for a page feel.

### E3. Ink, highlighter, lettering, randomness

**Randomness.** The shell passes a 32-bit `seed` (from the post id). Every element gets its own seed, `hashSeed(seed + ":" + kind + ":" + label)`, so editing one element does not reshuffle the others. All jitter comes from `mulberry32`. No `Math.random`.

**Ink strokes.** rough.js on the SVG (`rough.svg(svgEl)`), with defaults `{ roughness: cfg.roughness (1.5), bowing: 1.3, strokeWidth: 2.4, stroke: cfg.inkColor, seed: elementSeed, fill: undefined }`. Arrows use strokeWidth 2.2. The bracket uses 2.0.

**Wobble filter** on the ink group:

```xml
<filter id="wobble" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="{seed mod 1000}" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="0.35"/>
</filter>
```

**Highlighter.** A rough ellipse on `#hl` with `stroke: cfg.highlighter`, `strokeWidth: 13`, `roughness: 2.2`, no fill. The number is drawn in ink on top.

**Lettering** (`lettering.ts`, `letters(text, { x, y, size, anchor: "middle" | "start", seed })`):
- Font: `cfg.handwritingFont`, weight 700 when the font has it (Kalam, Caveat), otherwise 400 (Patrick Hand SC).
- Labels are ALL CAPS (the runtime uppercases defensively).
- One SVG `<text>` per label, with **one `<tspan>` per glyph** at an absolute x position. Advances come from canvas `measureText` with the same font, plus 1.5 px letter spacing.
- Per glyph: rotation uniform in [-3.5, 3.5] degrees (`rotate` attribute), baseline offset in [-2.5, 2.5] px, size factor in [0.94, 1.06].
- Per label: a baseline slope uniform in [-1.5, 1.5] degrees, applied as a y offset proportional to x.
- Sizes: title 64, bigBox label 46, circleWord 40, plain 40, marker number 40, other labels 38, column headings 28, bracket items 30.
- Labels wider than the shape allows wrap onto 2 lines at a word boundary (bigBox, pill). Line height is 1.05 times the size.
- The text box recorded in the registry is the `<text>` element's `getBBox()`.

### E4. Scene API

The API reference is also given to Opus in the scene prompt, so the implementation must match it exactly.

#### File: `style/diagram-api.md`
~~~~markdown
# Diagram scene API

A scene is a JavaScript file that calls `scene()` once with a function. The function receives the drawing API. Coordinates are in pixels on a 1080 x 1350 canvas, origin top-left. For every element, (x, y) is the CENTER of the element. Labels are ALL CAPS strings. Every element function returns a handle that `arrow()` and `marker()` accept.

```js
scene(({ title, pill, chain, bigBox, threeCol, bracket, icon, circleWord, plain, wavyLines, arrow, marker }) => {
  title("THE DELEGATION LOOP");
  const split = threeCol("TASK SPLIT", ["SCOPE", "VERIFY", "OWN"], { x: 720, y: 640 });
  const taste = circleWord("TASTE", { x: 270, y: 700 });
  arrow(taste, split, { bend: 0.2 });
  marker(1, split, { corner: "tl" });
});
```

## Elements

| Call | Draws | Default size |
|---|---|---|
| `title(text, { y = 110 })` | the page title, 64 px, centred at x 540, with a rough underline | n/a |
| `pill(label, { x, y, w, h })` | an oval around the label | w = label width + 70, h = 72 |
| `chain([labels], { x, y, dir = "right", gap = 60 })` | pills in sequence joined by short arrows; the first pill is centred at (x, y); returns an array of handles | as pill |
| `bigBox(label, { x, y, w = 360, h = 160 })` | a large rounded rectangle with a 46 px label | 360 x 160 |
| `threeCol(label, [a, b, c], { x, y, w = 480, h = 180 })` | the label above a box split into three columns with headings | 480 x 180 plus the label |
| `bracket(label, [items], { x, y })` | the heading, a horizontal curly brace under it, and the 2 or 3 items stacked under the brace | depends on text |
| `icon(name, label, { x, y, size = 90 })` | a crude icon with the label under it | 90 px icon |
| `circleWord(label, { x, y, r })` | the label inside a circle | r = max(label width / 2 + 30, 70) |
| `plain(label, { x, y })` | hand-lettered text with no shape | n/a |
| `wavyLines({ x, y, h = 160, count = 3, gap = 18 })` | parallel wavy vertical lines, a decoration with no label | n/a |

Icon names: `envelope`, `dollar`, `chart`, `clock`, `file`, `gear`, `warning`, `code`, `person`, `bolt`, `check`, `flag`.

## Connections and numbers

| Call | Draws |
|---|---|
| `arrow(from, to, { bend = 0.18, fromSide, toSide, head = "end" })` | a curved hand-drawn arrow. `from` and `to` are handles or `{ x, y }` points. It starts and ends at the edges of the elements (10 px gap). `bend` is the sideways curve as a fraction of the length; negative bends the other way. `fromSide` and `toSide` can force "top", "bottom", "left" or "right". `head` can be "end" or "both". |
| `marker(n, target, { corner = "tr" })` | the yellow highlighter circle with the number n (1 to 6) on a corner of the target: "tl", "tr", "bl", "br" |

## Rules the checker enforces
- Stay inside the safe area: x 60 to 1020, y 60 to 1290.
- Nothing overlaps: keep about 40 px of paper between elements, and arrows must not pass through any label.
- Use exactly the labels, kinds, columns, items, icons, edges and number order of diagram.json.
- Six markers, 1 to 6. Their order must not run simply left to right or top to bottom.
- The drawing must span at least 70% of the safe width and 60% of the safe height.
- At least 4 arrows. At most one element without an arrow.

## Checking your work
Run `npx tsx src/cli/diagram-check.ts --dir <post dir>`. It renders `image.png` in that folder and prints every problem with coordinates. Then open the image and look at it.
~~~~

### E5. Registry (`window.__diagram`)

```ts
{
  canvas: { w: 1080, h: 1350 },
  seed: number, font: string, paper: string, tiltDeg: number,
  title: { text: string, bbox: Box } | null,
  elements: {
    id: string;                 // kind-index, e.g. "threeCol-2"
    kind: "pill" | "bigBox" | "threeCol" | "bracket" | "icon" | "circleWord" | "plain";
    label: string;
    icon?: string; columns?: string[]; items?: string[];
    bbox: Box;                  // the whole element including its label and sub-texts
    shape: Box;                 // the drawn shape only (equals the text box for plain)
    texts: { text: string; role: "label" | "column" | "item"; bbox: Box }[];
  }[],
  decorations: { kind: "wavyLines"; bbox: Box }[],
  arrows: { from: string | null; to: string | null; points: { x: number; y: number }[]; bbox: Box }[],  // 24 samples along the curve
  markers: { n: number; target: string; center: { x: number; y: number }; r: number }[],
  warnings: string[],
  errors: string[]
}
```

API functions validate their arguments. A wrong type, an unknown icon, a marker number outside 1 to 6, or a duplicate marker number appends a clear message to `errors` (for example `marker(7, ...): n must be 1 to 6`) and skips the call. Exceptions thrown by the scene are caught and appended to `errors`. `window.__diagramReady = true` is set at the end in every case.

### E6. Shell (`diagramShellHtml(cfg, seed)`)

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><style>
/* fontFaceCss(handwriting font, available weights) */
html,body{margin:0;padding:0;width:1080px;height:1350px;overflow:hidden;background:#fff;}
#paper{position:absolute;left:0;top:0;width:1080px;height:1350px;/* paper mode CSS */}
svg{position:absolute;left:0;top:0;overflow:visible;}
#hl{mix-blend-mode:multiply;}
#ink{mix-blend-mode:multiply;opacity:.94;}
#grain{position:absolute;left:0;top:0;width:1080px;height:1350px;opacity:.18;pointer-events:none;/* greyscale noise */}
</style></head><body>
<div id="paper"></div>
<svg id="hl" width="1080" height="1350"><g id="hl-g"></g></svg>
<svg id="ink" width="1080" height="1350"><defs><!-- wobble filter --></defs><g id="ink-g" filter="url(#wobble)"></g></svg>
<div id="grain"></div>
<script>window.__DIAGRAM_CONFIG = { /* paper, font, inkColor, highlighter, roughness, maxTiltDegrees, seed, photo */ };</script>
<script src="http://lp.local/runtime/diagram-runtime.js"></script>
<script src="http://lp.local/post/scene.js"></script>
<script>window.__runScene();</script>
</body></html>
```

`__runScene` waits for `document.fonts.ready` and for the handwriting font to load before it runs the scene function, because lettering needs real glyph metrics. `renderDiagram` maps the `post/` route to the scene directory and waits for `window.__diagramReady === true`. A syntax error in `scene.js` surfaces as a page error, and `renderDiagram` rejects with it.

### E7. Validation, gate and check CLI

#### E7.1 `DiagramSpecSchema` and `validateDiagramSpec(spec, cfg, banned)`

```ts
{
  topic: string;
  title: string;
  elements: {
    label: string;
    kind: "pill" | "bigBox" | "threeCol" | "bracket" | "icon" | "circleWord" | "plain";
    columns?: [string, string, string];      // threeCol only
    items?: string[];                        // bracket only, 2 or 3
    icon?: "envelope" | "dollar" | "chart" | "clock" | "file" | "gear" | "warning" | "code" | "person" | "bolt" | "check" | "flag";  // icon only
    tags: ("cost" | "failure-mode" | "decision-rule")[];   // default []
    meaning: string;                         // one line, plain English, for SYSTEM SHOWN
  }[];
  decorations?: { kind: "wavyLines"; near?: string }[];
  edges: { from: string; to: string }[];     // labels
  order: string[];                           // 6 labels: who carries number 1..6
}
```

| Code | Rule |
|---|---|
| `element-count` | 5 to 7 elements |
| `unique-labels` | labels are unique |
| `label-caps` | labels, columns and items use only A to Z, 0 to 9 and single spaces, and are uppercase |
| `label-words` | labels 1 to 3 words; columns 1 or 2 words; items 1 to 3 words |
| `title` | 3 to 5 words, same character rules |
| `text-count` | 1 (title) + elements + 3 per threeCol + items: at most 14 |
| `kind-fields` | threeCol has exactly 3 columns; bracket has 2 or 3 items; icon has a valid icon; other kinds have none of these fields |
| `kinds` | at least 4 distinct kinds; at most one bigBox |
| `cost` | at least one element tagged `cost` or `failure-mode` |
| `decision-rule` | at least one element tagged `decision-rule` |
| `edges` | at least 4 edges; endpoints are existing labels; no self-loops; no duplicates (in either direction) |
| `order` | exactly 6 distinct existing labels |
| `meaning` | every element has a meaning of 10 to 160 characters |
| `dash`, `emoji`, `link`, `banned` | across all text, including meanings |

#### E7.2 `judgeDiagramGate(registry, spec, cfg, extras)`

`extras` holds the fonts and the pixel samples from the render. Boxes are compared in scene coordinates.

| Code | Fails when |
|---|---|
| `scene-error` | `registry.errors` is not empty |
| `title` | the title is missing or differs from `spec.title` |
| `labels-mismatch` | the element labels drawn differ from the spec (detail lists missing and extra) |
| `kind-mismatch`, `columns-mismatch`, `items-mismatch`, `icon-mismatch` | a drawn element differs from its spec entry |
| `markers` | not exactly 6 markers numbered 1 to 6 on distinct elements, or marker n is not on `spec.order[n-1]` |
| `order-regular` | with marker centres in number order: every next y is at least the previous y minus 40 (top to bottom), or every next x is at least the previous x minus 40 (left to right), or the order equals row-major reading order (rows are 150 px bands, then x) |
| `edges-mismatch` | a spec edge has no arrow between those two elements (either direction) |
| `arrows` | fewer than 4 arrows, an arrow end not attached to an element, or more than one element with no arrow |
| `overlap` | two element boxes intersect when each is grown by 16 px; a marker circle intersects any text box; a decoration intersects any text box |
| `arrow-crosses-label` | an arrow sample (excluding the first 3 and last 3) falls inside any text box grown by 6 px, the title included |
| `safe-area` | any element, title, marker, decoration or arrow box leaves x 60 to 1020 or y 60 to 1290 |
| `spread` | the union of element boxes is narrower than 672 px or shorter than 738 px |
| `kinds` | fewer than 4 distinct kinds, or more than one bigBox |
| `fonts` | the handwriting font is not loaded |
| `paper` | outside photo mode, the mean luminance of the four 50 x 50 corner samples is below 190 |
| `size` | the PNG is not 1080 x 1350 |

#### E7.3 `src/cli/diagram-check.ts`

`npx tsx src/cli/diagram-check.ts --dir <dir> [--out <dir>] [--seed <n>] [--json]`

1. Read and validate `<dir>/diagram.json`. Print the issues and exit 1 if the spec is invalid.
2. Read the seed: `--seed`, else `hashSeed(postId)` from `<dir>/stage.json`, else `hashSeed(basename(dir))`.
3. Render `<dir>/scene.js` into `<out>/image.png` and `<out>/image.html` (`out` defaults to `dir`).
4. Judge and write `<out>/gate.json`.
5. Print a readable report: `diagram-check: PASS`, or `diagram-check: FAIL (n issues)` followed by one line per issue with labels and coordinates (for example `- overlap: "REWORK TAX" (icon, x 700-880, y 960-1110) overlaps "CONTEXT DEBT" (bracket, x 160-420, y 940-1100)`), then `image: <path>`. The scene stage relies on these messages, so make them specific enough to fix without guessing.
6. Exit 0 pass, 1 gate or spec failure, 2 scene or render error (message printed).

### E8. Fixture

#### File: `tests/fixtures/diagram/delegation-loop/diagram.json`
~~~~json
{
  "topic": "How I decide what to hand to an AI agent",
  "title": "THE DELEGATION LOOP",
  "elements": [
    { "label": "TASK SPLIT", "kind": "threeCol", "columns": ["SCOPE", "VERIFY", "OWN"], "tags": [], "meaning": "Every task splits three ways: I scope it, the agent drafts and I verify, I own the merge." },
    { "label": "TASTE", "kind": "circleWord", "tags": [], "meaning": "The constant behind every split: judgment I cannot delegate." },
    { "label": "BLAST RADIUS", "kind": "bigBox", "tags": ["decision-rule"], "meaning": "If a mistake would break more than one module, I write it myself." },
    { "label": "CONTEXT DEBT", "kind": "bracket", "items": ["UNREAD DIFFS", "LOST INTENT"], "tags": ["failure-mode"], "meaning": "What piles up the moment I stop reading the agent's output." },
    { "label": "REWORK TAX", "kind": "icon", "icon": "clock", "tags": ["cost"], "meaning": "The time lost re-reading and redoing generated code." },
    { "label": "SHIP", "kind": "plain", "tags": [], "meaning": "The outcome, only when the split was right." }
  ],
  "edges": [
    { "from": "BLAST RADIUS", "to": "TASK SPLIT" },
    { "from": "SHIP", "to": "TASK SPLIT" },
    { "from": "TASK SPLIT", "to": "REWORK TAX" },
    { "from": "REWORK TAX", "to": "CONTEXT DEBT" },
    { "from": "CONTEXT DEBT", "to": "TASTE" },
    { "from": "TASTE", "to": "BLAST RADIUS" }
  ],
  "order": ["TASK SPLIT", "TASTE", "BLAST RADIUS", "CONTEXT DEBT", "REWORK TAX", "SHIP"]
}
~~~~

**Starter file** `tests/fixtures/diagram/delegation-loop/scene.js`. Write it with this content. Unlike the verbatim files, M06 may adjust coordinates and sizes slightly if the real glyph metrics make the fixture fail the gate. Record any adjustment in PROGRESS.md. `check-spec-files` does not check this file.

```js
scene(({ title, bigBox, threeCol, circleWord, bracket, icon, plain, arrow, marker }) => {
  title("THE DELEGATION LOOP");
  const blast = bigBox("BLAST RADIUS", { x: 300, y: 330, w: 380, h: 150 });
  const ship = plain("SHIP", { x: 860, y: 320 });
  const split = threeCol("TASK SPLIT", ["SCOPE", "VERIFY", "OWN"], { x: 720, y: 650, w: 500, h: 190 });
  const taste = circleWord("TASTE", { x: 250, y: 720, r: 100 });
  const debt = bracket("CONTEXT DEBT", ["UNREAD DIFFS", "LOST INTENT"], { x: 290, y: 1060 });
  const tax = icon("clock", "REWORK TAX", { x: 800, y: 1050 });
  arrow(blast, split, { bend: 0.2 });
  arrow(ship, split, { bend: -0.15 });
  arrow(split, tax, { bend: 0.15 });
  arrow(tax, debt, { bend: 0.2 });
  arrow(debt, taste, { bend: -0.2 });
  arrow(taste, blast, { bend: 0.25 });
  marker(1, split, { corner: "tl" });
  marker(2, taste, { corner: "tr" });
  marker(3, blast, { corner: "tl" });
  marker(4, debt, { corner: "tl" });
  marker(5, tax, { corner: "tr" });
  marker(6, ship, { corner: "tr" });
});
```

### E9. Font and paper bake-off (`npm run bakeoff`)

Renders the fixture scene with every handwriting font (Kalam, Caveat, Patrick Hand SC) on every paper mode except photo (dots, ruled, grid), plus photo when `assets/notebook/page.jpg` exists. Output: `out/bakeoff/<font>-<paper>.png`, and `out/bakeoff/index.html`, a grid of the images with the font and paper under each, the gate result (pass, or the issue codes), and the exact `config.json` lines to choose that combination. It never fails because of a gate result. It only fails if rendering itself breaks.

<!-- appendix:E:end -->

<!-- appendix:F:start -->
## Appendix F. Caption validator

`validateCaption(text, format, content, cfg, banned) -> { pass, issues, warnings, stats }`, where `stats = { graphemes, hookGraphemes, blocks, listLines, emoji }`. `content` is the post's card, poster or diagram JSON (needed by the format checks). Every issue has a `code`, a `message` written for the model (what is wrong and how to fix it), and an optional `detail`.

### F1. Normalisation and structure

1. Convert CRLF to LF, remove trailing spaces on every line, and trim leading and trailing blank lines. The pipeline saves the normalised text.
2. Split into **blocks** on one or more blank lines. A valid caption has exactly 5 blocks: hook, setup, list, payoff, CTA (Appendix A, base structure).
3. **Length** is counted in graphemes (`Intl.Segmenter`), newlines included.

### F2. Rules

| Code | Rule |
|---|---|
| `empty` | the caption is not empty |
| `structure` | exactly 5 blocks separated by blank lines (detail: the number of lines of each block found) |
| `hook-lines` | the hook block is exactly 1 line |
| `hook-length` | the hook line has at most `cfg.caption.hookMaxChars` (140) graphemes |
| `hook-opening` | the hook does not open with a greeting or throat-clear: `/^(hi|hello|hey|so,|i want to share|excited to|today i want|let me tell|i'm thrilled|big news)/i` |
| `setup-lines` | the setup block has 1 to 3 lines |
| `list-lines` | the list block has 3 to 7 lines (hook), 2 to 3 (poster), exactly 6 (diagram) |
| `bullets` | no list line starts with `- `, `* `, `• `, an en dash plus space, or a number followed by `.` or `)`; either every list line starts with `→ ` or none does |
| `line-length` | no list line is longer than 150 graphemes |
| `payoff-lines` | the payoff block has 1 or 2 lines |
| `cta` | the CTA block is 1 line, ends with `?`, has at least 4 words and contains exactly one `?` |
| `emoji-count` | exactly 1 emoji in the whole caption |
| `emoji-position` | that emoji is the first grapheme of a list line, or comes right after its `→ ` |
| `emoji-face` | the emoji is not a face |
| `dash` | no U+2014, U+2015 or U+2013, and no ` - ` or ` -- ` used as a dash between words |
| `link` | no URL: `/(https?:\/\/|www\.)\S+/i`, or a bare domain `/\b[a-z0-9-]+\.(com|io|ai|dev|app|co|net|org|it|xyz|ly|me|so|gg)\b/i` |
| `hashtag` | no hashtag: `/(^|\s)#[\p{L}\p{N}_]+/u` |
| `banned` | no banned phrase (detail lists them) |
| `length` | total graphemes inside `cfg.caption.ranges[format]` (detail: the count and the range) |
| `hook-restates-image` | hook format: the hook line does not contain the highlighted phrase and shares no run of 5 consecutive words with the image phrase |
| `poster-repeats-items` | poster format: no item title and no accent line appears in the caption, and no run of 5 consecutive words of any item body appears (all compared case-insensitively, punctuation stripped) |
| `diagram-walk` | diagram format: list line i (1 to 6) contains the label `content.order[i-1]`, case-insensitively |
| `diagram-image` | diagram format: the payoff block mentions the image (contains `image`, case-insensitive) |

Warnings (never block): `double-space`, `long-setup-line` (a setup line over 150 graphemes).

**Banned phrase matching** (`src/shared/banned.ts`): normalise curly apostrophes to `'` in both the text and the phrases, then match case-insensitively with Unicode word boundaries. A phrase that starts with a letter gets a `(?<![\p{L}\p{N}])` prefix, and one that ends with a letter gets a `(?![\p{L}\p{N}])` suffix. Phrases ending in `?` are matched literally at their end. Apply the same function to captions and to all image text.

### F3. Emoji detection (`src/captions/emoji.ts`)

Split into graphemes. A grapheme is an emoji when any of these holds:
- it contains a code point with `\p{Extended_Pictographic}`;
- it is a regional indicator pair (a flag);
- it is a keycap sequence (`[0-9#*]` + optional U+FE0F + U+20E3).

`→` (U+2192) is not Extended_Pictographic and must never count. `©`, `®` and `™` are Extended_Pictographic and do count. A ZWJ sequence or a skin-tone sequence is one grapheme, so it counts as one emoji.

**Face emoji**: the base code point falls in U+1F600 to U+1F64F, U+1F910 to U+1F92F, U+1F970 to U+1F97A, U+1F9D0, or is U+263A or U+2639.

### F4. CLI

`npx tsx src/cli/validate-caption.ts --format <hook|poster|diagram> --file <caption.txt> [--content <json>]` prints `caption: PASS (n graphemes)` or `caption: FAIL` followed by one line per issue, and exits 0 or 1. `--content` is required for the format checks. Without it, those checks are skipped with a warning.

### F5. Fixture captions

#### File: `tests/fixtures/captions/hook-valid-1.txt`
~~~~text
Every agent I use can produce a working feature in minutes, and that is exactly why the bottleneck in my work moved somewhere else.

The code is no longer the scarce part of building software.
Knowing which version of it deserves to exist is.
That is a different skill, and most hiring processes still do not test for it.

→ Agents give me five plausible implementations where I used to write one.
→ Plausible is the problem, because all five survive a quick code review.
→ 🧭 The work that matters now is rejecting four of them fast, for reasons I can explain.
→ That judgment only comes from shipping things and watching real people use them.
→ A developer without it does not get faster, they ship more average code per day.
→ Clients notice the average long before they notice the speed.
→ Building FlashFX solo made this obvious: the agent types, I decide.

Speed got cheap for everyone at the same time.
What separates developers now is what they refuse to merge.

When did you last reject AI-generated code that worked, and what made you say no?
~~~~

#### File: `tests/fixtures/captions/poster-valid-1.txt`
~~~~text
Every rule on this poster exists because I skipped it once and paid for it later.

None of them are clever.
They are the boring checks that agents make very easy to skip.

→ The one I still break most is the review tax, because it feels optional late at night.
→ 🔒 Owning the interfaces is the one that keeps FlashFX from turning into a rewrite.

The full list is in the image.

Which of these would your team drop first under a deadline?
~~~~

#### File: `tests/fixtures/captions/diagram-valid-1.txt`
~~~~text
Most of my AI coding time goes into deciding what not to hand over.

The prompt is the easy part.
Routing the task is where the hours go, and where they leak.

→ Task split: I scope, the agent drafts, I verify, I own the merge.
→ Taste decides every split, and it is the one thing I cannot delegate.
→ Blast radius is the rule: if a mistake breaks more than one module, I write it myself.
→ 🧾 Context debt piles up the moment I stop reading diffs.
→ Rework tax is what that debt costs me, usually the next morning.
→ Ship only happens when the split was right the first time.

It breaks on greenfield work, where I cannot judge blast radius yet.
Full system in the image.

What is the one task you stopped delegating after it burned you?
~~~~

The hook fixture belongs with `tests/fixtures/hook/taste.json`, the poster fixture with `tests/fixtures/poster/items-9.json`, and the diagram fixture with `tests/fixtures/diagram/delegation-loop/diagram.json`.

<!-- appendix:F:end -->

<!-- appendix:G:start -->
## Appendix G. Claude sessions, usage limits, fake Claude

### G1. `runClaude(opts)` (`src/claude/session.ts`)

```ts
interface RunClaudeOptions {
  label: string;                 // e.g. "post 3/12 diagram scene", used in event lines
  stage: string;
  model: string;                 // "opus" | "sonnet" | full model id
  prompt: string;                // full prompt text
  promptFile: string;            // where to write it, relative to repo root (e.g. content/_staging/<id>/prompts/caption-1.md)
  logFile: string;               // raw stream-json lines are appended here
  tools: "none" | "scene" | "crash-review" | "crash-fix";
  maxTurns: number;
  stallMinutes: number;
  maxMinutes: number;
  onEvent?: (e: SessionEvent) => void;   // { kind: "tool", summary } | { kind: "text", text } | { kind: "result", ... }
}
interface RunClaudeResult {
  outcome: "ok" | "limit" | "transient" | "stall" | "timeout" | "error";
  finalText: string;
  resetAt: Date | null;
  limitMessage: string | null;
  turns: number;
  durationMs: number;
  model: string | null;          // from the init event
  exitCode: number | null;
}
```

**Command line.** `claude -p "Read the file <promptFile> and follow its instructions exactly." --model <model> --output-format stream-json --verbose --max-turns <n>` plus the tool flags below. Write `promptFile` with forward slashes. The instruction argument never contains quotes or shell metacharacters.

| `tools` | Extra flags |
|---|---|
| `none` | `--disallowedTools "Bash,Write,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task"` (reading files stays possible) |
| `scene` | `--permission-mode acceptEdits --allowedTools "Read,Write,Edit,Bash(npx tsx src/cli/diagram-check.ts:*)"` |
| `crash-review` | `--permission-mode dontAsk --allowedTools "Read,Grep,Glob,Write,Bash(git log:*),Bash(git diff:*),Bash(git status:*)"` (use `acceptEdits` instead of `dontAsk` if `claude --help` does not list `dontAsk`) |
| `crash-fix` | `--dangerously-skip-permissions` |

`claudeCapabilities()` runs `claude --help` once per process and caches which permission modes and flags exist.

**Spawning.** Binary = `cfg.claude.bin` plus `cfg.claude.prefixArgs`. On win32, when the bin is `claude`, resolve it with `where claude`. A `.cmd` or `.bat` result is spawned with `shell: true`, wrapping arguments that contain spaces in double quotes. A `.exe` is spawned directly. `cwd` is the repo root, stdin is ignored, and the environment gets `DISABLE_AUTOUPDATER=1`. Read stdout line by line. Append every line to `logFile`.

**Stall and timeout.** Check every 15 seconds. If no stdout line arrived for `stallMinutes`, kill the process tree and return `stall`. If the total time exceeds `maxMinutes`, kill and return `timeout`. On win32 kill with `taskkill /PID <pid> /T /F`. Elsewhere use a detached process group, SIGTERM, then SIGKILL after 5 seconds.

**Events.** Map assistant `tool_use` blocks to summaries: `$ <command>` for Bash, `write <path>`, `edit <path>`, `read <path>`, `tool <name>`. Map text blocks to `says: <first line>`. Pass them to `onEvent`.

**Outcome classification** (same rules as the build runner):
- `limit`:
  - an assistant event with model `<synthetic>`, `error: "rate_limit"` or `apiErrorStatus: 429` whose text matches a usage-limit phrase;
  - or result or stderr text matching a usage-limit phrase;
  - or an init event whose model does not contain the requested family (`opus`, `sonnet`), which means a silent fallback.
  
  `resetAt = parseLimit(text)?.resetAt ?? now + cfg.usageLimit.fallbackMinutes`.
- `transient`: API error text matching `/overloaded|529|500|502|503|504|ECONNRESET|ETIMEDOUT|network|socket hang up|rate.?limit/i` without a usage-limit phrase.
- `ok`: a `result` event with `subtype: "success"` and `is_error: false`.
- `error`: everything else (non-zero exit without a result, `error_max_turns`, `is_error: true`).

### G2. Usage limits (`src/claude/limits.ts`)

`isLimitMessage(text)` and `parseLimit(text, now, defaultTz)` behave exactly like `builder/lib/limits.mjs` (PROMPT.md section 7). Restated here so this batch is self-contained:

Known message shapes:

```
Claude AI usage limit reached|1762912800
You've hit your session limit · resets 3:45pm
You've hit your weekly limit · resets Mon 12:00am
Claude usage limit reached. Your limit will reset at 3pm (America/Santiago).
You're out of extra usage · resets 6:40pm (America/New_York)
5-hour limit reached ∙ resets 2am
Weekly limit reached · resets Thu, Nov 13, 3:00 PM
Opus weekly limit reached · resets Nov 14, 9am (Europe/Rome)
```

- Detection: `/usage limit|hit your (session |weekly )?limit|limit reached|out of extra usage|limit will reset/i`. Never match `max turns`.
- Times: `h`, `h:mm` with am/pm in any case, or 24h `HH:mm`. Optional weekday, optional `Mon DD` date, optional IANA timezone in parentheses. The default timezone is the system's.
- With no date: the next occurrence of that wall-clock time. With a weekday: the next such weekday. With a date: that date (next year if it has passed).
- Convert an IANA zone's wall-clock time to UTC with `Intl` only (guess, compute the offset with `formatToParts`, correct, repeat once for DST).
- A result in the past by less than 10 minutes becomes now + 5 minutes.
- The runner waits until `resetAt + cfg.usageLimit.bufferMinutes` (2).

`src/cli/limits-selftest.ts` runs a table of at least 12 cases with a fixed `now` of `2026-11-12T01:12:00+01:00` (Europe/Berlin), including a midnight crossing, a same-day weekday that has passed, an explicit timezone, the epoch form, an unparseable limit message, and `max turns limit reached` (not a limit).

### G3. Prompt engine (`src/claude/prompt.ts`)

`renderPrompt(templatePath, vars)`:
1. Resolve includes first: `{{> path}}` is replaced by the content of that file (path relative to the repo root), recursively, with a maximum depth of 5. A missing file throws `include not found: <path> (in <template>)`. A cycle throws.
2. Then replace variables: `{{name}}` with `vars[name]`. A variable not in `vars` throws `missing variable "<name>" in <template>`. Values are inserted as is and never re-scanned.
3. Any `{{` left in the template text throws. Check the template after includes and before inserting values, so a value that happens to contain `{{` is fine.
4. Return the text with exactly one trailing newline.

### G4. Output extraction (`src/claude/extract.ts`)

- `extractJson(text, schema)`: take the content of the last fenced block whose info string is `json`. If there is none, take the substring from the first `{` to the last `}`. `JSON.parse` it. On a syntax error throw `ExtractError` with the position and a 60-character excerpt. Then `schema.safeParse`. On failure throw with a list of `path: message`. The messages go into repair notes, so keep them precise.
- `extractCaption(text)`: the content between a line that is exactly ```` ```caption ```` and the next line that is exactly ```` ``` ````. If the text has no fences at all, use the whole text. Then apply the F1 normalisation.
- `extractFinalLine(text)`: the last non-empty line, used for `SCENE READY`, `REVIEW DONE` and `FIX APPLIED`.

### G5. Fake Claude (`tests/fake-claude/fake-claude.mjs`)

A Node script that accepts the same arguments as `claude`. It must make every pipeline path testable without spending usage.

- Find the prompt file from the `-p` argument with `/Read the file (\S+) and follow/`. Read it. The first line is `STAGE: <stage>`, the second `FORMAT: <format>`. Read `--model`.
- Emit stream-json lines:
  1. `{"type":"system","subtype":"init","model":"claude-<family>-fake","session_id":"fake"}`, where `<family>` is `opus` or `sonnet` from `--model`.
  2. One assistant text event.
  3. Tool events where the stage uses tools.
  4. `{"type":"result","subtype":"success","is_error":false,"result":<final text>,"num_turns":2,"duration_ms":<n>}`.
- Responses per stage:

| Stage | Response |
|---|---|
| `idea` | a JSON idea whose topic and keyTerms include a unique counter token (for example `fake topic 7`, keyTerms `["fake7", ...]`) so dedup accepts it. The pillar cycles 1 to 6. |
| `hook-content` | if the prompt line `PHRASE FROM BANK:` holds a phrase, use it verbatim: break it into 2 lines and highlight the last word. Otherwise return `tests/fixtures/hook/taste.json`. |
| `poster-content` | `tests/fixtures/poster/items-9.json` |
| `diagram-design` | `tests/fixtures/diagram/delegation-loop/diagram.json` |
| `diagram-scene` | copy `tests/fixtures/diagram/delegation-loop/scene.js` to the `POST DIR:` folder, emit a Bash tool event for the diagram check, final text `SCENE READY` |
| `caption` | `tests/fixtures/captions/<format>-valid-1.txt` inside a caption fence |
| `audit` | `{"claims":[],"unsupported":0}` |
| `crash-review` | write a short fix file (Diagnosis, Fix plan "no code change needed, simulated crash", Verify `npm test`) to the `OUTPUT FILE:` path; final text `REVIEW DONE: simulated crash` |
| `crash-fix` | final text `FIX APPLIED: simulated` (changes nothing) |

- Scenarios via `LP_FAKE_SCENARIO` (comma-separated). "Once" scenarios trigger on the first matching call only, tracked in a state file (`LP_FAKE_STATE`, default `out/tmp/fake-claude-state.json`):

| Scenario | Effect |
|---|---|
| `limit-once` | the first call emits an assistant event with model `<synthetic>`, `"error":"rate_limit"`, text `Claude AI usage limit reached\|<epoch now + LP_FAKE_LIMIT_SECONDS (default 3)>`, and exits 1 |
| `caption-invalid-once` | the first caption contains an em dash character (built in code from the escape sequence backslash-u-2014, so no source file contains the character) |
| `poster-wrap-once` | the first poster content has `title_line1` = `"MMMMMMM MMMMMMMM"` (valid length, wraps in the render) |
| `audit-unsupported-once` | the first audit returns one unsupported caption claim |
| `idea-duplicate` | the idea stage always returns the same topic and keyTerms |
| `stall-once` | the first call prints the init event and then sleeps 60 seconds |
| `scene-fail-once` | the first scene session writes a scene with two elements at the same coordinates |

- The run-night process (not the fake) supports `LP_FAKE_CRASH_ONCE=1`: it throws `Error("simulated crash")` once, tracked in the same state file.

<!-- appendix:G:end -->

<!-- appendix:H:start -->
## Appendix H. Stage prompts

Every prompt starts with `STAGE: <name>` on line 1 and `FORMAT: <format>` on line 2. The fake Claude and the root `CLAUDE.md` rely on this. The pipeline renders each template with `renderPrompt` (G3) and writes it to the post's `prompts/` folder.

### H1. Variables

| Template | Variables |
|---|---|
| `prompts/idea.md` | `format`, `formatSummary`, `recentHistory`, `lastPillar`, `facts`, `rejections` |
| `prompts/hook-content.md` | `topic`, `angle`, `bankPhrase`, `facts`, `recentPhrases`, `repairNotes` |
| `prompts/poster-content.md` | `topic`, `angle`, `facts`, `recentTitles`, `repairNotes` |
| `prompts/diagram-design.md` | `topic`, `angle`, `facts`, `recentTitles`, `repairNotes` |
| `prompts/diagram-scene.md` | `postDir`, `exampleScene`, `repairNotes` |
| `prompts/caption.md` | `format`, `captionAddendum`, `bannedPhrases`, `facts`, `imageSummary`, `topic`, `angle`, `repairNotes` |
| `prompts/audit.md` | `format`, `facts`, `imageText`, `caption` |
| `prompts/crash-review.md` | `outputFile`, `crashLog`, `gitLog`, `runState` |
| `prompts/crash-fix.md` | `fixFile` |

How the values are built:
- `facts`: Appendix A facts block.
- `recentHistory`: the last 30 history entries, newest first, as `- [format] topic | angle (pillar N)`. If there are none, `(none yet)`.
- `lastPillar`: the pillar of the newest history entry, or `none`.
- `rejections`: one line per idea rejected in this post's idea attempts, with the reason (for example `- "Code review is the new bottleneck": too similar to 20261111-...`). If there are none, `(none)`.
- `recentPhrases`: the last 30 hook phrases. `recentTitles`: the last 30 poster titles (`line1 line2`) and diagram titles.
- `bankPhrase`: the phrase taken from the phrase bank, or `(none)`.
- `formatSummary`: from `src/pipeline/summary.ts` (I10).
- `captionAddendum`: the content of `style/caption-<format>.md`.
- `bannedPhrases`: the non-comment lines of `style/banned-phrases.txt`, comma-separated.
- `imageSummary` and `imageText`: I10.
- `exampleScene`: the content of `tests/fixtures/diagram/delegation-loop/scene.js`.
- `postDir`: the post's staging directory, relative to the repo root, with forward slashes.
- `repairNotes`: empty on the first attempt. On a repair:

  ```
  ## Your previous attempt failed these checks
  Previous answer:
  <previous output, truncated to 6000 characters>

  Problems to fix:
  - [<code>] <message>
  ...

  Fix every problem. Keep everything that already passed.
  ```

#### File: `prompts/idea.md`
~~~~markdown
STAGE: idea
FORMAT: {{format}}

You choose the topic for one LinkedIn post by Gabriele Bolognese. This is an unattended pipeline: there is no human to answer questions. Do not use any tool except reading files.

{{> style/voice.md}}

{{> content/pillars.md}}

## The format of this post
{{formatSummary}}

## Recent posts, newest first (do not repeat their topic, angle or main claim)
{{recentHistory}}

## Pillar of the previous post
{{lastPillar}} (choose a different pillar)

## Facts (the only source for first-person numbers, dates, results and events)
{{facts}}

## Ideas already rejected for this post
{{rejections}}

## What makes a good topic
- Arguable: someone in the audience could disagree, and you can say who and why.
- Operator altitude: about how the work goes, what it costs, where it breaks. Not tips, not tools, not news.
- It fits the format above exactly.
- Specific enough that it could only come from someone who builds software with agents every day.

## Output
Answer with only one json block, nothing before or after it:

```json
{
  "pillar": 3,
  "topic": "one line, under 90 characters",
  "angle": "one or two sentences: the specific claim or tension the post will make",
  "whyArguable": "who would disagree, and why",
  "factIds": ["F04"],
  "keyTerms": ["3 to 6 practitioner nouns, lowercase"]
}
```
~~~~

#### File: `prompts/hook-content.md`
~~~~markdown
STAGE: hook-content
FORMAT: hook

You write the text of a hook card image for a LinkedIn post by Gabriele Bolognese. This is an unattended pipeline: there is no human to answer questions. Do not use any tool except reading files.

{{> style/voice.md}}

{{> style/format-hook.md}}

## This post
Topic: {{topic}}
Angle: {{angle}}

PHRASE FROM BANK: {{bankPhrase}}

If a phrase is given above (anything other than "(none)"), use it exactly as written, without changing a single character. Your job is then only the highlight and the line breaks. If it says "(none)", write the phrase yourself, following "Writing the phrase".

## Facts (the only source for first-person numbers, dates, results and events)
{{facts}}

## Recent hook phrases (do not reuse or paraphrase them)
{{recentPhrases}}

{{repairNotes}}

## Output
Answer with only one json block, nothing before or after it:

```json
{
  "phrase": "the full sentence, plain text",
  "lines": ["first line", "second line with the <hl>payload</hl>"],
  "highlight": "payload"
}
```

The lines joined with single spaces, with the tags removed, must equal the phrase exactly. Exactly one <hl>...</hl> pair across all lines.
~~~~

#### File: `prompts/poster-content.md`
~~~~markdown
STAGE: poster-content
FORMAT: poster

You write the complete content of an editorial poster image for a LinkedIn post by Gabriele Bolognese. This is an unattended pipeline: there is no human to answer questions. Do not use any tool except reading files.

{{> style/voice.md}}

{{> style/format-poster.md}}

## This post
Topic: {{topic}}
Angle: {{angle}}

## Facts (the only source for first-person numbers, dates, results and events)
{{facts}}

## Recent poster and diagram titles (do not repeat them)
{{recentTitles}}

{{repairNotes}}

## Output
Answer with only one json block, nothing before or after it:

```json
{
  "number": "7",
  "title_line1": "Rules I Ship",
  "title_line2": "AI Code By:",
  "items": [
    { "n": "1", "title": "Read the Diff", "body": "...", "accent_line": "...", "tags": ["cost"] }
  ]
}
```

tags: "cost" when the item names a real cost, tradeoff or failure mode; "concrete" when it contains a number or a specific detail from real work. Do not add colours, footers or file names. Before answering, count the characters of every title line (max 16), item title (max 24), body (max 120) and accent line (max 55), and shorten anything that is over.
~~~~

#### File: `prompts/diagram-design.md`
~~~~markdown
STAGE: diagram-design
FORMAT: diagram

You design the system shown in a hand-drawn notebook diagram for a LinkedIn post by Gabriele Bolognese. You do the intellectual work: the topic is only a subject, and inventing a genuinely good system is your job. This is an unattended pipeline: there is no human to answer questions. Do not use any tool except reading files.

{{> style/voice.md}}

{{> style/format-diagram.md}}

## This post
Topic: {{topic}}
Angle: {{angle}}

## Facts (the only source for first-person numbers, dates, results and events)
{{facts}}

## Recent poster and diagram titles (do not repeat them)
{{recentTitles}}

{{repairNotes}}

## Output
Answer with only one json block, in this shape. The example below is a different topic and is shortened; do not copy it.

```json
{
  "topic": "How I decide what to hand to an AI agent",
  "title": "THE DELEGATION LOOP",
  "elements": [
    { "label": "TASK SPLIT", "kind": "threeCol", "columns": ["SCOPE", "VERIFY", "OWN"], "tags": [], "meaning": "Every task splits three ways: I scope it, the agent drafts and I verify, I own the merge." },
    { "label": "BLAST RADIUS", "kind": "bigBox", "tags": ["decision-rule"], "meaning": "If a mistake would break more than one module, I write it myself." },
    { "label": "CONTEXT DEBT", "kind": "bracket", "items": ["UNREAD DIFFS", "LOST INTENT"], "tags": ["failure-mode"], "meaning": "What piles up the moment I stop reading the output." },
    { "label": "REWORK TAX", "kind": "icon", "icon": "clock", "tags": ["cost"], "meaning": "The time lost re-reading and redoing generated code." }
  ],
  "decorations": [],
  "edges": [ { "from": "BLAST RADIUS", "to": "TASK SPLIT" } ],
  "order": ["TASK SPLIT", "TASTE", "BLAST RADIUS", "CONTEXT DEBT", "REWORK TAX", "SHIP"]
}
```

Rules for the JSON: 5 to 7 elements; "order" names exactly 6 of them; every edge uses existing labels; at least 4 edges. Count the text elements before answering: the title, every label, three per threeCol, every bracket item. The maximum is 14.
~~~~

#### File: `prompts/diagram-scene.md`
~~~~markdown
STAGE: diagram-scene
FORMAT: diagram

You draw a hand-drawn notebook diagram by writing a scene script, then you check it and fix it until it is right. This is an unattended pipeline: there is no human to answer questions.

POST DIR: {{postDir}}

## Files
- {{postDir}}/diagram.json: the system to draw. Use exactly its labels, kinds, columns, items, icons and edges, and put marker n on the element named at position n of "order". Do not add, rename or drop labels.
- Write your script to {{postDir}}/scene.js. Do not create or change any other file.

{{> style/diagram-api.md}}

## Layout rules
{{> style/format-diagram.md}}

## Example scene
This is a different system. It shows API usage and spacing. Do not copy its layout.

```js
{{exampleScene}}
```

{{repairNotes}}

## Process
1. Read diagram.json. Plan the page: where each element goes on the 1080 x 1350 canvas, which elements connect, and where the six numbers will land so that their order is scattered.
2. Write {{postDir}}/scene.js.
3. Run: npx tsx src/cli/diagram-check.ts --dir {{postDir}}
4. Read the report, then open {{postDir}}/image.png with the Read tool and look at it.
5. Fix scene.js and repeat until the check passes AND the page looks like real working notes: readable at phone size, using the whole page, arrows clear of labels, nothing cramped, numbers scattered.

Run the check at most 8 times.

Your final message must be exactly one line: SCENE READY, or SCENE FAILED: <reason>
~~~~

#### File: `prompts/caption.md`
~~~~markdown
STAGE: caption
FORMAT: {{format}}

You write the LinkedIn caption that goes with an image, for a post by Gabriele Bolognese. This is an unattended pipeline: there is no human to answer questions. Do not use any tool except reading files.

{{> style/voice.md}}

{{> style/caption-base.md}}

{{captionAddendum}}

## Banned phrases (never use them, in any casing)
{{bannedPhrases}}

## Facts (the only source for first-person numbers, dates, results and events)
{{facts}}

## The image of this post
{{imageSummary}}

## This post
Topic: {{topic}}
Angle: {{angle}}

{{repairNotes}}

## Output
Answer with only the caption, inside one fenced block that opens with ```caption on its own line and closes with ``` on its own line. Use real line breaks and real blank lines. No character count, no title, no commentary.
~~~~

#### File: `prompts/audit.md`
~~~~markdown
STAGE: audit
FORMAT: {{format}}

You check a LinkedIn post for invented facts. You do not rewrite anything. This is an unattended pipeline: there is no human to answer questions. Do not use any tool except reading files.

The post is published under Gabriele Bolognese's name. Every first-person specific claim must be true, and the only proof is the facts list below.

## Facts list
{{facts}}

## Text on the image
{{imageText}}

## Caption
{{caption}}

## What needs a fact
- First-person numbers: hours, days, percentages, counts, sizes, money, versions.
- First-person dated events or results: "last week I shipped", "I cut the build time".
- Named customers, companies, people, awards, programs, places.

## What does not need a fact
Opinions, principles, general descriptions of how the work goes, and hypotheticals clearly framed as such ("if a task touches two modules").

## Output
Answer with only one json block, nothing before or after it:

```json
{
  "claims": [
    { "where": "caption", "text": "exact quote of the claim", "kind": "number", "factId": "F03", "supported": true }
  ],
  "unsupported": 0
}
```

"where" is caption or image. "kind" is one of number, event, result, name. "factId" is null when no fact supports the claim, and then "supported" is false. "unsupported" counts the claims with supported false. An empty claims list is a valid answer.
~~~~

#### File: `prompts/crash-review.md`
~~~~markdown
STAGE: crash-review
FORMAT: n/a

You are a senior engineer diagnosing a crash of the LinkedIn Poster night runner. You do not change code. You write exactly one file: {{outputFile}}. This is unattended: there is no human to answer questions.

## Crash log (last lines)
{{crashLog}}

## Recent commits
{{gitLog}}

## Runner state
{{runState}}

Investigate the code in src/ and runner/ as needed. Find the root cause, not the symptom.

Write {{outputFile}} with exactly these sections:

## Diagnosis
## Fix plan
(numbered, file by file, concrete enough to apply without redoing the diagnosis; include the regression test to add)
## Verify
(commands; always include npm test)

Rules: never write the em dash character. Never touch builder/, spec.md, PROMPT.md, content/ or config.json.

Your final message must be exactly one line: REVIEW DONE: <one-line diagnosis>
~~~~

#### File: `prompts/crash-fix.md`
~~~~markdown
STAGE: crash-fix
FORMAT: n/a

You apply a fix plan for a crash of the LinkedIn Poster night runner. This is unattended: there is no human to answer questions.

1. Read {{fixFile}} completely.
2. Apply the fix plan to src/ and tests/ only. Never touch builder/, spec.md, PROMPT.md, content/, config.json or runner/run.sh.
3. Add the regression test from the plan.
4. Run npm test and npm run typecheck until both pass.
5. Run git add -A, then git commit -m "runner fix: <short summary>".
6. Never write the em dash character.

Your final message must be exactly one line: FIX APPLIED: <summary>, or FIX FAILED: <reason>
~~~~

<!-- appendix:H:end -->

<!-- appendix:I:start -->
## Appendix I. Post pipeline

### I1. Stages per format

```
hook:     idea* -> hook-content -> render (gate, rescue) -> caption -> audit -> publish
poster:   idea  -> poster-content -> render (gate)        -> caption -> audit -> publish
diagram:  idea  -> diagram-design -> diagram-scene (+ runner check) -> caption -> audit -> publish
```

`*` For a hook card that takes a phrase from the phrase bank, the idea stage makes no model call. The idea is built from the phrase: `topic` and `angle` = the phrase, `pillar` = the next pillar after the last one used, `keyTerms` = its content words, `factIds` = [].

### I2. Stage contract

```ts
type StageName = "idea" | "content" | "scene" | "render" | "caption" | "audit" | "publish";
interface StageContext {
  postId: string; format: Format; dir: string;   // staging dir
  cfg: Config; runId: string;
  state: StageState;                               // stage.json, saved after every change
  emit: (line: string) => void;                    // event lines
}
```

- **Idempotent.** A stage listed in `state.completed` whose output file exists and validates is skipped. `machine.ts` runs the stages in order and saves `stage.json` after each one.
- **Attempts.** `state.attempts[stage]` counts model calls per stage, across restarts.
- **Expected failures** (retries exhausted, invalid output that repairs could not fix) throw `StageFailure(stage, reason, issues)`. The post moves to `_failed/`, and the run continues with the next post.
- **Session outcomes:**
  - `limit` throws `LimitReached(resetAt, message)`. It propagates to the run process, which saves state and exits 75.
  - `transient` throws `TransientError`, and the process exits 76.
  - `stall`, `timeout` and `error` count as a failed attempt of that stage. The next attempt gets repair notes saying `the previous session ended with <outcome>`.
- **Anything else** (a TypeError, a bug) propagates unchanged. The run process exits non-zero, and the night runner's crash fixer takes over (Appendix J). The staging folder stays, so the post resumes after the fix.

### I3. Stage details

**idea** (model `models.idea`, schema `IdeaSchema = { pillar: 1..6, topic, angle, whyArguable, factIds: string[], keyTerms: string[] }`)
1. Render `prompts/idea.md`, run with `tools: "none"`, extract with the schema.
2. Check `pillar` differs from the last pillar used. Check that every `factIds` entry exists among the usable facts (drop unknown ids with a warning).
3. Dedup (I8). A rejected idea gets a line in `rejections`, and the stage retries up to `retries.idea`.
4. Write `idea.json`.

**content: hook-content** (model `models.hookContent`, schema `HookCardSchema`)
1. Take the phrase bank phrase if any (I6), then render, run and extract.
2. Set `fromBank`.
3. Run `validateCard` (with `expectedPhrase` when from the bank). On issues, repair up to `retries.contentRepair`.
4. Write `card.json`.

**content: poster-content** (model `models.posterContent`): the same flow with `validatePoster`. Write `poster.json`.

**content: diagram-design** (model `models.diagramDesign`): the same flow with `validateDiagramSpec`. Write `diagram.json`.

**render** (hook, poster)
1. Render into the post dir (`image.html`, `image.png`, `gate.json`).
2. For the hook, a gate failing only on `wrap`/`width` triggers the rescue (C5). A rescued card is saved back to `card.json` with an entry in `stage.json` history.
3. If the gate still fails, repair the content stage with the gate issues as repair notes (a gate failure counts against `retries.gateRepair`, and each content repair inside it counts against `retries.contentRepair`), then render again.

**scene** (diagram, model `models.diagramScene`, `tools: "scene"`, `sessions.sceneMaxTurns`, `sessions.sceneMaxMinutes`)
1. Render `prompts/diagram-scene.md`, then run the session. Stream its tool events as event lines.
2. After the session, whatever its final line says, the pipeline itself runs the check (render + judge) on the post dir.
3. Pass: done. Fail: run another session (up to `retries.sceneSessions`) with repair notes holding the check report.
4. Write `image.png`, `image.html` and `gate.json`.

**caption** (model `models.caption`)
1. Render `prompts/caption.md`, run, and extract with `extractCaption`.
2. Validate with `validateCaption`. On issues, repair up to `retries.captionRepair`.
3. Write `caption.txt` and `validation.json`.

**audit** (model `models.audit`, schema `AuditSchema`)
1. Run with `imageText` and the caption, and write `audit.json`.
2. If `unsupported > 0`:
   - Claims with `where: "image"`: repair the content stage with notes listing the claims to remove or rephrase without a number or event, then redo render (or scene), caption and audit.
   - Otherwise: repair the caption with notes listing the claims, then re-validate and re-audit.
   - Both count against `retries.auditRepair`.
3. Still unsupported after that: `StageFailure("audit", ...)`. An invented fact is never published.

**publish**
1. Build `post.json` (G8): `status: "ready"`, `captionChars` = grapheme length, models and durations from `stage.json`, and `content` = the validated content JSON.
2. Validate it with `PostSchema`.
3. `moveDirWithRetry(staging, posts/<id>)`.
4. Append to history (`status: "ready"`, `phraseOrTitle` = the hook phrase, `line1 line2` of the poster, or the diagram title).
5. Mark the bank phrase as used.

### I4. Failure handling

On `StageFailure`:
1. Write `failure.json` (`{ stage, reason, issues, at }`).
2. Move staging to `_failed/<id>`.
3. Append history with `status: "failed"`.
4. Return a bank phrase to the top of the queue.
5. Emit `post <i>/<n> FAILED at <stage>: <reason>`.

### I5. `machine.ts`

`runPost({ format, cfg, runId, resumeId?, emit }) -> { status: "ready" | "failed", postId }`. Without `resumeId`, it creates the post id and the staging dir. With `resumeId`, it loads `stage.json` and continues. It records `durationsMs` per stage and the model used per stage.

### I6. Phrase bank (`src/pipeline/phraseBank.ts`)

`content/phrase-bank.md` has a `## Queue` and a `## Used` section. Queue entries are lines starting with `- `. Operations:
- `takePhrase()`: removes the first queued phrase and writes the file back.
- `markUsed(phrase, postId)`: appends `- <phrase> (<postId>)` under Used.
- `restorePhrase(phrase)`: puts it back at the top of the queue.

Everything else in the file (headings, intro text, comments) is preserved. A phrase longer than 90 characters is skipped, moved under Used with `(skipped: too long)`, and logged as a warning.

### I7. Rotation (`src/pipeline/rotation.ts`)

`nextFormat(history, rotation, start?)`: with `start` (from `--rotation-start`) use it for the first post of the run. Otherwise take the format of the newest history entry (ready or failed), and return the next format in `rotation`, cycling. With an empty history, use `rotation[0]`. `--format` forces one format for every post of the run.

### I8. Dedup (`src/pipeline/dedup.ts`)

Tokens = lowercase words of 3 or more letters from `topic + angle + keyTerms`, minus a stopword list. An idea is rejected when, against any of the last `dedup.historyWindow` history entries:
- the token Jaccard similarity is at least `dedup.similarityThreshold` (0.5), or
- the topic slug is identical, or
- (hook) the phrase is identical to a previous phrase.

The rejection reason names the post it collides with.

### I9. `src/cli/gen.ts`

Runs `--count` posts sequentially in one process. Flags are listed in batch M10. Event lines:

```
[02:11:03] post 2/3 poster 20261112-021103-poster-rules-for-agent-code | idea ok (sonnet, 18s): "Rules for letting agents touch production code"
[02:12:40] post 2/3 poster ... | content ok (opus, 1m 37s, attempt 1)
[02:12:46] post 2/3 poster ... | render ok, gate pass (990 px tall)
[02:13:10] post 2/3 poster ... | caption ok (sonnet, 24s, 512 chars, attempt 2: fixed hook-length)
[02:13:31] post 2/3 poster ... | audit ok (0 unsupported)
[02:13:31] post 2/3 poster ... | READY
```

Exit codes: 0 when every post ended ready or failed-handled, 75 usage limit (staging kept; resume with `--resume <postId>`), 76 transient, 1 crash, 2 invalid usage. On 75 it also writes `runner/state/limit.json` (`{ resetAt, message, postId, stage }`).

### I10. Summaries (`src/pipeline/summary.ts`)

`formatSummary(format)`:
- hook: `Hook card: one sharp, arguable sentence of at most 90 characters, which the caption then explains. The topic must reduce to a single claim.`
- poster: `Editorial poster: 4 to 9 rules, mistakes or principles from real work, each with a title, a body and a reframing accent line. The topic must support a list of distinct, arguable items.`
- diagram: `Notebook diagram: a system of 5 to 7 elements, including a cost or failure mode and an if/then decision rule, drawn as hand-written notes. The topic must be a process, a loop or a decision system.`

`imageSummary(format, content)`:
- hook: `Hook card. The image shows only this sentence: "<phrase>". The highlighted phrase is "<highlight>".`
- poster: `Editorial poster. The image shows everything below in full, so the caption must not repeat it.` followed by `Number: <n>. Title: "<line1> <line2>".` and one line per item, `<n>. <title>: <body> / <accent_line>`.
- diagram: `Notebook diagram titled "<title>". Numbered elements in reading order:` followed by `<n>. <LABEL> (<kind>): <meaning>` for the six ordered elements. Then `Other elements:` with the same format for the rest, then `Arrows: A -> B, ...`.

`imageText(format, content)`: the text actually visible on the image: the phrase; or the title lines and every item field; or the title, labels, columns and items (meanings are not visible).

<!-- appendix:I:end -->

<!-- appendix:J:start -->
## Appendix J. Night runner

### J1. `runner/run.sh`

```
bash runner/run.sh [--count N] [--format hook|poster|diagram] [--rotation-start hook|poster|diagram]
                   [--fake] [--content-dir DIR] [--fresh] [--yes] [--resume] [--force] [--help]
```

- `--count`: ready posts to produce (default `config.json` `defaultCount`). The run stops at N ready posts, or after 2N attempts.
- `--fake`: use the fake Claude (`LP_FAKE=1`). Used by tests.
- `--content-dir`, `--fresh`, `--yes`: as in `gen`.
- `--resume`: continue the last run (`runner/state/night.json`) instead of starting a new one.
- `--force`: take over a lock older than 18 hours, or whose PID is gone.

Responsibilities:
1. `set -uo pipefail`. `cd` to the repo root. Create `runner/state/`, `runner/logs/`, `runner/state/fixes/`.
2. Generate a `runId` (or read it with `--resume`). The log file is `runner/logs/<runId>.log`. Export `LP_LOG_FILE` so the Node processes append to the same file. Every bash line is printed with `[HH:MM:SS]` and appended (helper `say`).
3. Preflight: Node 20 or newer, then `npx tsx src/cli/run-night.ts --preflight` (config valid, fonts present, Chromium installed, runtime bundle builds, content files exist; warns when fewer than 5 usable facts; with `--fake` it skips the claude check). On failure, exit 3.
4. Outer loop (J2).
5. On exit, print the final summary that `run-night` wrote (`content/runs/<runId>.md`).

### J2. Outer loop and exit codes

```
attempt loop:
  npx tsx src/cli/run-night.ts --run-id "$RUN_ID" --count "$COUNT" [flags] [--resume after the first iteration]
  case $? in
    0)  done, break
    75) usage limit: read runner/state/limit.json, print it,
        npx tsx src/cli/wait-until.ts --until <resetAt + buffer> --reason "usage limit" (countdown every heartbeat), then loop with --resume
    76) transient: back off with the next value of usageLimit.transientBackoffMinutes (scaled by LP_WAIT_SCALE), then loop with --resume.
        Once the list is exhausted, treat it as 75 with the fallback wait.
    77) lock held by another run: print the owner, exit 4
    2)  invalid usage: exit 2
    *)  crash: crash fixer (J3); if it succeeds, loop with --resume; if it fails or the fix cap is reached, exit 1
  esac
```

`src/cli/wait-until.ts --until <ISO> --reason <text>` sleeps in 30-second steps. It prints `[HH:MM:SS] waiting for usage limit reset (minute M of ~T), resumes at HH:MM.` every `heartbeatSeconds`, honours `LP_WAIT_SCALE`, and returns at once if the target has passed (laptop sleep).

### J3. Crash fixer (Gabriele's standard pattern)

When `run-night` exits with an unexpected code:
1. `fixes += 1` (persisted in `night.json`). If `fixes > crashFixer.maxFixesPerNight`, print `crash fixer cap reached` and exit 1.
2. Safety: the working tree must be clean (`git status --porcelain` ignoring gitignored files), unless `LP_CRASH_ALLOW_DIRTY=1` (tests). Record `PRE_FIX_SHA`.
3. Write `runner/state/crash-<ts>.log` with the last 200 lines of the run log plus `runner/state/last-crash.json`.
4. Review (Opus): `npx tsx src/cli/claude-run.ts --mode crash-review --crash-log <file> --out runner/state/fixes/fix-<ts>.md`. If it exits 75, wait for the limit, then retry the review.
5. Fix (Sonnet): `npx tsx src/cli/claude-run.ts --mode crash-fix --fix-file runner/state/fixes/fix-<ts>.md`.
6. Verify in bash: `npm test && npm run typecheck`. On failure, `git reset --hard "$PRE_FIX_SHA"` (unless `LP_CRASH_ALLOW_DIRTY=1`), print `crash fixer failed, the code is restored, stopping`, and exit 1.
7. Print `crash fixed: <last commit subject>` and continue with `--resume`.

Every step prints what it is doing, and the Claude sessions print their tool events.

### J4. `src/cli/run-night.ts` and `src/runner/night.ts`

- Flags: `--run-id`, `--count`, `--format`, `--rotation-start`, `--content-dir`, `--fresh`, `--yes`, `--resume`, `--preflight`, `--force`.
- Lock (`src/runner/lock.ts`): `runner/state/run.lock` holds `{ pid, runId, startedAt }`. If another live run holds it, exit 77. A stale lock (PID gone, or older than 18 hours with `--force`) is taken over. Release it on exit.
- State `runner/state/night.json`: `{ runId, target, ready: string[], failed: {...}[], attempts, currentPostId, currentFormat, startedAt, waits, crashes, fixes, fake }`. Written atomically after every post and before every exit.
- Loop: (M14) process the queue first (Appendix L1). Then, while `ready < target` and `attempts < 2 * target`, pick the format (I7), run `runPost` (resuming `currentPostId` if set), and update the state.
- **Heartbeat** every `heartbeatSeconds` (default 120), exact format:

  ```
  [02:14:00] still generating post 5/12 (poster) (minute 3), stage: render, ready: 4, failed: 0, waits: 1. last: $ npx tsx src/cli/diagram-check.ts --dir ...
  ```

  `minute` counts from the start of the current post. `last:` is the latest event (shortened to 100 characters).
- Event lines: the I9 lines, plus session tool events for the scene and crash stages (`post 5/12 diagram | $ npx tsx src/cli/diagram-check.ts ...`, `write .../scene.js`, `read .../image.png`).
- `LimitReached`: save state, write `runner/state/limit.json`, exit 75. `TransientError`: exit 76. Uncaught error: write `runner/state/last-crash.json` (`{ message, stack, postId, stage, at }`), log the stack, exit 1. `LP_FAKE_CRASH_ONCE=1` throws a simulated crash once, right after the first post's idea stage.
- At the end: write the run report (G8) and print:

  ```
  ==== night run run-20261112-010203 finished in 5h 12m ====
  ready: 12 (hook 4, poster 4, diagram 4) | failed: 1 | usage-limit waits: 2 (3h 05m) | crashes fixed: 0
  failed: 20261112-033012-diagram-... at scene: gate failed after 2 sessions (overlap)
  next: npm run app, then open http://localhost:5173
  ```

### J5. `src/cli/claude-run.ts`

`--mode crash-review --crash-log <file> --out <file>`, or `--mode crash-fix --fix-file <file>`. It renders the prompt (variables from H1: `gitLog` = `git log --oneline -15`, `runState` = `night.json`), runs `runClaude` with `tools` set to the mode and `sessions.crashMaxTurns`, prints tool events, and exits 0 (ok and the expected file exists for the review), 75 (limit, and writes `limit.json`), 76 (transient) or 1.

### J6. Logs

`runner/logs/<runId>.log` holds everything printed by bash and Node, without ANSI codes. Each Claude session's raw stream is kept in the post folder's `logs/`, and the crash sessions' streams in `runner/logs/<runId>-crash-<ts>-<mode>.jsonl`.

### J7. Runner tests

- `tests/runner/limit-sim.sh`: `LP_FAKE_SCENARIO=limit-once LP_FAKE_LIMIT_SECONDS=3 LP_WAIT_SCALE=0.01 LP_HEARTBEAT_SECONDS=1 bash runner/run.sh --fake --count 1 --content-dir out/limit-test --fresh --yes`, with output saved to `out/limit-test.log`. It asserts that the log contains `usage limit` and `waiting for usage limit reset`, that the run resumed, and that `assert-content --content-dir out/limit-test --ready 1` passes. Exit non-zero on any failed assertion, printing which.
- `tests/runner/crash-sim.sh`: `LP_FAKE_CRASH_ONCE=1 LP_CRASH_ALLOW_DIRTY=1 bash runner/run.sh --fake --count 1 --content-dir out/crash-test --fresh --yes`. It asserts that the log contains `crash fixer`, `REVIEW DONE` and `crash fixed`, and that one post is ready.
- Both scripts delete their fake state file first, so "once" scenarios trigger.

<!-- appendix:J:end -->

<!-- appendix:K:start -->
## Appendix K. Review app

### K1. Stack and files

```
app/
  index.html
  vite.config.ts          # root: app/; plugins: react(), lpApi(); server.host 127.0.0.1; port from config.json (overridable with --port)
  tsconfig.json
  server/api.ts           # export function lpApi(): Plugin, with the middleware in configureServer and configurePreviewServer
  src/main.tsx
  src/App.tsx
  src/components/Header.tsx  Tabs.tsx  PostCard.tsx  CaptionView.tsx  CaptionEditor.tsx  SystemShown.tsx  Lightbox.tsx  Toasts.tsx
  src/lib/api.ts  clipboard.ts  download.ts  dates.ts
  src/styles.css
```

The middleware imports the shared modules from `src/` (schemas, `validateCaption`, `loadConfig`, paths). The content dir comes from `LP_CONTENT_DIR` or `config.json`. The app reads content on every request, so new posts appear without restarting. `vite build` outputs to `out/app/`.

### K2. API (Vite middleware, JSON, localhost only)

Post ids are checked against `/^\d{8}-\d{6}-(hook|poster|diagram)-[a-z0-9-]+$/` before touching the filesystem (no path traversal). Bodies are limited to 200 KB. Errors return `{ error }` with status 400, 404 or 500.

| Method and path | Behaviour |
|---|---|
| `GET /api/posts?status=ready\|posted\|rejected\|all` | `{ posts, counts: { ready, posted, rejected, failed }, postsPerDay, ranges }`. Each post is the full `post.json` plus `imageUrl` (`/api/posts/<id>/image.png?v=<mtime>`), `captionToUse` (`editedCaption ?? caption`), `validation` (validateCaption of captionToUse), and `systemShown` for diagrams (`[{ n, label, meaning }]`). Ready posts are sorted by createdAt ascending (FIFO), posted by postedAt descending, rejected by createdAt descending. |
| `GET /api/posts/:id/image.png` | the PNG, `cache-control: no-cache` |
| `PATCH /api/posts/:id` | body `{ status?, editedCaption?, rejectedReason? }`. Status changes: ready to posted sets `postedAt` = now; posted to ready clears it; ready to rejected needs `rejectedReason`; rejected to ready clears it. `editedCaption` (string or null) is validated and saved even with issues; the response returns the updated post with `validation`. Written atomically. |
| `POST /api/validate-caption` | body `{ id, caption }` gives `{ issues, warnings, stats }` (uses the post's format and content) |
| `GET /api/failed` | the `_failed` posts: `{ id, format, stage, reason, at, imageUrl \| null }` |
| `GET /fonts/*` | serves `assets/fonts/` for the app's own headings |

### K3. Interface

- **Header**: the title "LinkedIn Poster", count chips (Ready, Posted, Rejected, and Failed from M14), `Surplus: <ready / postsPerDay, one decimal> days at <postsPerDay>/day`, and a refresh button. Auto-refresh every 30 seconds while no editor is open.
- **Tabs**: Ready (default), Posted, Rejected (Failed is added in M14). A format filter: All, Hook card, Poster, Diagram.
- **Card**: two columns when the window is at least 1100 px wide (image left, up to 440 px wide; text right), stacked on narrow windows. Card header: a format badge (hook: warm beige; poster: green `#2F7A3E` outline; diagram: highlighter yellow), the suggested date on Ready cards (K5), the creation time, and the post id in small monospace.
- **Image**: full width of its column. A click opens a lightbox at full resolution. Escape closes it.
- **Caption**: `white-space: pre-wrap`, system-ui 15 px, line-height 1.45 (close to LinkedIn), the hook line in bold weight. A thin dashed rule labelled `see more (approx.)` after the hook line. A character chip `1043 / 900 to 1300`, green inside the range and amber outside. Validation issues of the caption are listed in red under it.
- **Buttons**:
  - Ready tab: **Post this** (primary), Copy text, Download image, Edit, Reject.
  - Posted tab: Copy text, Download image, Move back to ready.
  - Rejected tab: Restore.
- **Edit**: an inline textarea prefilled with `captionToUse`. Live validation with a 300 ms debounce (`POST /api/validate-caption`). Buttons: Save (PATCH `editedCaption`), Cancel, Revert to original (PATCH `editedCaption: null`).
- **Reject**: an inline reason input with Confirm and Cancel. Never use `window.prompt`, `alert` or `confirm`.
- **Diagram cards**: a collapsible "System shown" list of the numbered elements with their meanings.
- **Toasts**: bottom-right, hidden after 5 seconds. The Post this toast has Undo, which PATCHes status back to ready.
- **Empty Ready tab**: `No ready posts. Generate some: bash runner/run.sh --count 12`.
- **Style**: calm and editorial. Page background `#F4F3EF`, white cards with a 1 px `#E4E2DC` border and 14 px radius. EB Garamond for headings (from `/fonts/`), system-ui for everything else. No UI library.

### K4. Post this

1. When a card mounts, prefetch its image as a Blob and keep an object URL (revoked on unmount).
2. On click (a user gesture), first `await navigator.clipboard.writeText(captionToUse)`. If that throws, fall back to a hidden textarea with `document.execCommand('copy')`. If both fail, show an error toast and stop.
3. Trigger the download: an anchor with `href` set to the object URL (fetch now if the prefetch is not done), `download = "linkedin-<id>.png"`, click it.
4. PATCH `status: "posted"`.
5. Toast: `Caption copied, image downloaded, marked as posted.` with Undo. The card leaves the Ready tab.

Copy text and Download image do steps 2 and 3 alone, without changing the status.

### K5. Suggested dates

Ready posts in FIFO order. The start date is today if no post has `postedAt` today, otherwise tomorrow. Post i gets `start + floor(i / postsPerDay)` days. Show it as `Thu 13 Nov` (en-GB short weekday, day, short month).

### K6. Tests

- `tests/app/api.test.ts`: create synthetic post folders in a temp content dir (valid `post.json` plus a small PNG), mount the middleware on a bare `node:http` server, and test:
  - listing and the status filter;
  - FIFO order;
  - every allowed status transition and that `postedAt` is set and cleared;
  - rejecting without a reason fails;
  - `editedCaption` with an em dash is saved and returned with a `dash` issue;
  - unknown id gives 404;
  - an id with `..` gives 400;
  - `/api/failed` lists a failed folder.
- `tests/e2e/app.spec.ts` (Playwright, Chromium, clipboard permissions granted on the context, `acceptDownloads: true`):
  1. The page shows 3 Ready cards whose images loaded (`naturalWidth > 0`).
  2. Post this on the first card: the clipboard text equals that card's caption; a download fires with the suggested filename `linkedin-<id>.png`; the toast is visible; the Ready count is 2; the Posted tab shows the post.
  3. Undo returns it to Ready.
  4. Edit: typing an em dash shows the `dash` issue; Save stores the edit; Post this then copies the edited text.
  5. Reject with a reason moves the card to Rejected; Restore brings it back.
- `tests/e2e/playwright.config.ts`: `testDir: tests/e2e`, Chromium only. `webServer`: `npm run app -- --port 5199 --strictPort` with `env: { LP_CONTENT_DIR: "out/e2e-content" }`, url `http://127.0.0.1:5199`, timeout 120 s. `globalSetup` runs `npm run gen -- --fake --count 3 --content-dir out/e2e-content --fresh` and resets the fake state file first.

<!-- appendix:K:end -->

<!-- appendix:L:start -->
## Appendix L. Regenerate queue, doctor, README

### L1. Regenerate queue

`content/queue.json`: an array of `{ id (uuid), type: "regenerate" | "regenerate-caption" | "retry-failed", postId, requestedAt, status: "pending" | "done" | "failed", note? }`.

App additions:
- On Ready cards, a "Regenerate" menu with two choices: "Whole post (same topic)" and "Caption only".
- A Failed tab listing `_failed` posts (stage, reason, time, image if any) with a "Retry" button.
- A small "Queued" badge on cards with a pending queue item.
- API: `POST /api/queue { type, postId }` (rejects duplicates of a pending item) and `GET /api/queue`.

Runner processing (before new posts in `run-night`, or alone with `gen --queue-only`):
- `regenerate`: a new post with a new id and the same format. The idea is copied from the original, so the idea stage makes no model call. `regeneratedFrom` = the original id. On success, the original becomes `rejected` with the reason `replaced by <newId>`.
- `regenerate-caption`: copy the post folder to staging under the same id. Remove `caption.txt`, `validation.json` and `audit.json`, and remove caption and audit from `completed`. Run caption, audit and publish. Publishing replaces the original atomically: move the original to `out/tmp/replaced/<id>-<ts>`, then move staging into place. `editedCaption` resets to null.
- `retry-failed`: move `_failed/<id>` back to staging. Reset the attempts of the failed stage and remove it from `completed`. Resume.

Each item is marked `done` or `failed` with a note. Queue items do not count toward `--count`. Each one is reported in the run summary.

### L2. Doctor (`npm run doctor`)

Prints one line per check, with a check or cross mark and a hint:
- Node version 20 or newer;
- dependencies installed;
- the Playwright Chromium executable exists;
- every font file from B1 is present;
- the diagram runtime bundles;
- `config.json` is valid;
- the content files exist, with the usable fact count, VERIFY count, pillar count and phrase bank queue size;
- git is clean;
- the `claude` CLI is found and reports a version;
- the last run report (date, ready, failed).

`--no-claude` skips the Claude checks. `--smoke` adds a real `claude -p` call (`Reply with exactly: OK`, Sonnet, one turn). Exit 1 if any check fails. Warnings never fail.

### L3. README.md (complete)

Sections:
1. What this is (three formats, the pipeline, the night runner, the app).
2. The daily workflow: run the night runner in the evening, open the app in the morning, Post this, paste into LinkedIn.
3. Commands, with every flag of `runner/run.sh`, `gen`, `diagram-check`, `validate-caption`, `doctor`, `bakeoff`, `calibrate`.
4. How each format is made, and where its rules live (`style/`, `prompts/`).
5. Editing the rules safely: what to change in `style/` versus `prompts/`, and that `npm run prompts:check` must still pass.
6. Facts bank and phrase bank.
7. Notebook photo mode and the font bake-off.
8. A `config.json` reference with every key.
9. How the runner handles usage limits, transient errors and crashes. Where the logs, reports, fix files and failed posts are.
10. Troubleshooting: Chromium missing, a stuck lock, usage limit loops, Windows path and line-ending issues, a post failing the same gate repeatedly.
11. The NEXT steps from batch M14.

<!-- appendix:L:end -->
