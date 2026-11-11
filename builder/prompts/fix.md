You apply a fix plan written by a reviewer for one batch of the LinkedIn Poster project. There is no human to answer questions.

BATCH: {{BATCH_ID}}. {{BATCH_TITLE}}
FIX ROUND: {{ROUND}}
FIX PLAN: {{FIX_FILE}}

Steps:
1. Read {{FIX_FILE}} completely. Then read {{CONTEXT_FILE}} for the specification.
2. Apply every step of the Fix plan. Do not redesign. If a step is wrong, make the minimal correct change and say so in PROGRESS.md.
3. Run the commands in the Verify section and these acceptance commands, from the repo root, in Git Bash:
{{ACCEPTANCE_LIST}}
   Iterate until they pass.
4. Never modify builder/, spec.md or PROMPT.md. Never write the em dash character.
5. Append one line under the "## {{BATCH_ID}}" section of PROGRESS.md: "- Fix {{ROUND}}: <what changed>".
6. git add -A and git commit -m "{{BATCH_ID}} fix {{ROUND}}: <short summary>". Leave a clean working tree.

Your final message must be exactly one line:
FIX {{BATCH_ID}}/{{ROUND}} APPLIED: <summary>
or
FIX {{BATCH_ID}}/{{ROUND}} INCOMPLETE: <what still fails>
