# AI and resources used

| Date | Tool | Used for | What I changed or rejected |
| 2026-10-30 | Claude (Sonnet 5.5) | Planned Step 1;  tests for the NestJS project | wrote the config schema, health endpoint, app setup |
| 2026-10-30 | Claude | Compose with Atlas Local | Code, tests and docs | schema bootstrap (validator, indexes, search index), GET /ready, tests, runbook
| 2026-10-30 | (importer). Claude (Sonnet 5.5, Claude Code) drafted the cleaning rules, the upsert and report code, unit and integration tests, the 500-row sample selection and the runbook section. Found while building: the plan's "trim" rule was too narrow, so it became "collapse whitespace". I [ran X, read every file, changed or rejected Y].|