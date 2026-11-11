# LinkedIn Poster

If your prompt begins with a line `STAGE: <name>`, you are a content-generation session of the finished product. Ignore everything below this paragraph and follow only your prompt.

## For build sessions
This repository is built batch by batch from `spec.md` by the unattended build runner in `builder/`.
- Never modify `builder/`, `spec.md` or `PROMPT.md`.
- Read `PROGRESS.md` before you start: it records what earlier batches built and decided.
- Implement only the batch you were given. Commit when done. Leave a clean working tree.
- No em dash characters (U+2014) in any file.
