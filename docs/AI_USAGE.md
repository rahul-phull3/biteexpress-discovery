# AI and resources used

| Date | Tool | Used for | What I changed or rejected |
| 2026-10-30 | Claude (Sonnet 5.5) | Planned Step 1;  tests for the NestJS project | wrote the config schema, health endpoint, app setup |
| 2026-10-30 | Claude | Compose with Atlas Local | Code, tests and docs | schema bootstrap (validator, indexes, search index), GET /ready, tests, runbook
| 2026-10-30 | (importer). Claude (Sonnet 5.5, Claude Code) drafted the cleaning rules, the upsert and report code, unit and integration tests, the 500-row sample selection and the runbook section. Found while building: the plan's "trim" rule was too narrow, so it became "collapse whitespace". I [ran X, read every file, changed or rejected Y].|
feat(api): create and fetch restaurants with RFC 9457 errors
| 2026-11-01 | Claude (Sonnet 5.5, Claude Code session) | no help taken |create and fetch restaurants POST /v1/restaurants and GET /v1/restaurants/{id}.|
2026-11-01 | Step 5, list endpoint | Claude drafted the query schema, the MongoDB query builder with $geoNear, an independently written in-memory twin with shared contract tests, the city/cuisine cache, the explain script and the runbook section, and ran mutation checks on them |