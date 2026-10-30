# Runbook: running, checking and testing BiteExpress locally

How to start the database and the API, check that they work, look inside
MongoDB, run every kind of test, and fix the usual problems. Commands are
written for Windows PowerShell. The `npm` and `docker` commands work the same in
any shell.

## At a glance

| I want to | Command |
| --- | --- |
| Start MongoDB (Atlas Local) in Docker | `npm run db:up` |
| Run the API with auto-reload | `npm run start:dev` |
| Ask "is the process alive?" | `curl.exe -i http://localhost:3000/health` |
| Ask "can it serve traffic?" | `curl.exe -i http://localhost:3000/ready` |
| See what the API created in MongoDB | `npm run db:inspect` |
| Open a MongoDB shell | `npm run db:shell` |
| Watch the database refuse bad data | `npm run db:validator-demo` |
| Run the unit tests | `npm test` |
| Run the HTTP tests (no database needed) | `npm run test:e2e` |
| Run the tests against a real MongoDB | `npm run test:int` |
| Lint, type-check, unit and HTTP tests in one go | `npm run check` |
| Follow the database log | `npm run db:logs` |
| Stop everything, keep the data | `npm run db:down` |
| Delete all local data and start clean | `npm run db:reset` |
| Run the API and the database both in Docker | `npm run stack:up` |

## 1. What you need

- Node.js 24.9 or newer: `node --version`.
- Docker Desktop, started and showing "Engine running": `docker compose version`.
- Free ports 27017 (MongoDB) and 3000 (API). Section 3.10 explains how to change them.
- About 2 GB of free memory for the database container. It runs MongoDB and the
  Atlas Search process together.

## 2. First-time setup

Run these in the repository root (the folder that contains `package.json`).
Commit your Step 1 work first, so that `git status` afterwards shows only what
Step 2 changed.

```powershell
# 1. Unzip the Step 2 files over the repository
Expand-Archive -Path "$HOME\Downloads\step2-overlay.zip" -DestinationPath . -Force

# 2. Review what changed. package.json should differ only by the mongodb
#    dependency and the new scripts.
git status
git diff package.json

# 3. Install the new dependency (this also updates package-lock.json: commit it)
npm install

# 4. Optional: create your local settings. Every value in .env.example is also
#    the built-in default, so you only need a .env to change something.
Copy-Item .env.example .env

# 5. Start MongoDB, then the API
npm run db:up
npm run start:dev
```

`.env` must stay out of Git. If `git status` lists it, add it to `.gitignore`.

## 3. Everyday tasks

### 3.1 Start the database

```powershell
npm run db:up
```

This runs `docker compose up -d --wait --wait-timeout 180 mongodb`. The first
run downloads the image and creates the volumes, which takes a few minutes. After
that it waits until the image's own health check reports that both MongoDB and
the search process are up; plan on about a minute. When it finishes you see
`Container biteexpress-mongodb-1  Healthy`.

Check at any time:

```powershell
docker compose ps
```

The `STATUS` column should say `healthy`.

### 3.2 Start the API

```powershell
npm run start:dev      # compiles, starts, and restarts when you save a file
```

Other ways to run it:

```powershell
npm run build          # compile to dist/
npm run start:prod     # run the compiled code, as the Docker image does
```

On a first start against an empty database you should see log lines like these
(the second start says "Updated" and "already exists" instead):

```text
LOG [SchemaBootstrapService] Created collection "restaurants" with its $jsonSchema validator
LOG [SchemaBootstrapService] Indexes in place: tenant_location_2dsphere, tenant_city_score, tenant_city_cuisine_score, tenant_source_unique
LOG [SchemaBootstrapService] Search index "restaurants_search" requested; it builds in the background
LOG [NestApplication] Nest application successfully started
```

Stop it with Ctrl+C. The shutdown hook closes the MongoDB connection first.

### 3.3 Check that it works

Use `curl.exe`, not `curl`: in Windows PowerShell 5.1, `curl` is an alias for
a different command.

```powershell
curl.exe -i http://localhost:3000/health
curl.exe -i http://localhost:3000/ready
```

`-i` prints the status line and headers. To pretty-print the JSON:

```powershell
curl.exe -s http://localhost:3000/ready | ConvertFrom-Json | ConvertTo-Json -Depth 5
```

Expected for `/health`: `200 OK`, `Cache-Control: no-store` and
`{"status":"ok","uptimeSeconds":...,"timestamp":"..."}`.

Expected for `/ready` once everything is up: `200 OK` and a body like

```json
{
  "status": "ready",
  "timestamp": "2026-10-30T13:05:11.482Z",
  "mongodb": { "status": "up", "latencyMs": 3 },
  "indexes": {
    "status": "ok",
    "present": ["_id_", "tenant_location_2dsphere", "tenant_city_score", "tenant_city_cuisine_score", "tenant_source_unique"],
    "missing": []
  },
  "search": { "index": "restaurants_search", "status": "READY", "queryable": true }
}
```

In the first seconds after the very first start, `search.status` can read
`PENDING` or `BUILDING` with `queryable: false`. The endpoint is still `200`.
Section 5 explains every field.

**Failure drill (worth doing once, and good to show in the follow-up):**

```powershell
docker compose stop mongodb
curl.exe -i http://localhost:3000/health   # still 200: the process is alive
curl.exe -i http://localhost:3000/ready    # 503, mongodb.status "down"
docker compose start mongodb
curl.exe -i http://localhost:3000/ready    # 200 again once MongoDB answers
```

While MongoDB is down, the `/ready` error typically reads `ping timed out after
2000 ms`. That is the point of having two endpoints: a database outage makes the instance
"not ready" (a load balancer stops sending traffic) without making it "not
alive" (an orchestrator does not restart a healthy process in a loop).

### 3.4 Look inside the database

```powershell
npm run db:inspect
```

Prints the validator settings, every regular index (flagging unique and partial
ones), the Atlas Search index with its status, and the document count. It only
reads.

For free-form questions, open a shell in the `biteexpress` database:

```powershell
npm run db:shell
```

Then type these at the `biteexpress>` prompt:

```js
show collections
db.restaurants.countDocuments()
db.restaurants.getIndexes()
db.restaurants.getSearchIndexes()
db.getCollectionInfos({ name: 'restaurants' })[0].options.validator
db.restaurants.find().limit(3)
exit
```

A graphical client works too (MongoDB Compass, or the MongoDB extension for VS
Code). Use this connection string, including `directConnection=true`:

```text
mongodb://127.0.0.1:27017/?directConnection=true
```

### 3.5 Watch the database refuse bad data

```powershell
npm run db:validator-demo
```

Copies the live validator onto a scratch collection called `validator_demo`,
tries six inserts, prints `ACCEPTED` or `REJECTED` with the server's error code
for each, and removes the scratch collection. Your `restaurants` collection is
never touched. Expect rejections (error 121) for a missing `tenantId`, a status
other than `active` or `inactive`, a longitude of 200 and a price range of 9,
and acceptance for a valid restaurant and for one with an extra field.

### 3.6 Run the tests

| Command | Needs | What it proves |
| --- | --- | --- |
| `npm test` | nothing | Pure logic: config schema, bootstrap call order and error handling, readiness decisions, URI redaction, the collection definition |
| `npm run test:e2e` | nothing | The real Nest app over HTTP with MongoDB faked: routes, status codes, headers, the `/v1` prefix not applying to the probes |
| `npm run test:int` | `npm run db:up` | What only a real server can prove: validator rejections (error 121), indexes exist, bootstrap is repeatable, unique and partial index behaviour, `$geoNear` ordering and distances, `/ready` against the real database |
| `npm run check` | nothing | Lint, type-check, `npm test` and `npm run test:e2e`, stopping at the first failure |

`npm run test:int` creates a throwaway database named `biteexpress_it_<random>`
and drops it when it finishes, so the data in `biteexpress` is never touched.

Run less than everything:

```powershell
npx jest src/health/readiness.spec.ts                      # one unit file
npx jest -t "gives up on a check"                          # tests whose name contains this text
npx jest --config ./test/jest-e2e.json test/ready.e2e-spec.ts   # one e2e file
npm run test:watch                                         # rerun unit tests when you save
npm run test:cov                                           # unit tests with a coverage table
```

Other quality commands: `npm run lint` (oxlint), `npm run typecheck` (tsc, no
output files), `npm run format` (Prettier rewrites files).

Suggested sequence before every commit:

```powershell
npm run format
npm run check
npm run db:up        # if it is not already running
npm run test:int
```

### 3.7 Stop, pause, resume

| Goal | Command |
| --- | --- |
| Stop the API | Ctrl+C in its terminal |
| Stop and remove the containers, keep the data | `npm run db:down` |
| Pause only the database | `docker compose stop mongodb` |
| Resume it | `docker compose start mongodb` |

Your data lives in Docker volumes, so it survives `db:down` and a reboot. Run
`npm run db:up` and everything is as you left it.

### 3.8 Start clean

```powershell
npm run db:reset     # docker compose down -v: deletes the containers AND the data volumes
npm run db:up
```

Use it when you want an empty database, or when startup stops with "already
exists with a different definition" after you changed an index.

### 3.9 Run everything in containers (demo mode)

```powershell
npm run stack:up       # builds the API image, starts MongoDB and the API, waits until both are healthy
docker compose ps
curl.exe -i http://localhost:3000/ready
docker compose logs -f api
npm run db:down        # stops both
```

Run `npm run stack:up` again after changing code: it rebuilds the image. Do not
run `npm run start:dev` at the same time on port 3000. Either stop it, or set
`API_PORT=3100` in `.env` and call `http://localhost:3100`.

The two modes differ only in where the API runs and so how it reaches MongoDB:

| | API runs | `MONGODB_URI` the API uses |
| --- | --- | --- |
| Everyday (3.1 and 3.2) | on your machine | `mongodb://127.0.0.1:27017/?directConnection=true` |
| Demo (3.9) | in a container | `mongodb://mongodb:27017/?directConnection=true` (set in `docker-compose.yml`) |

### 3.10 Change a setting, or use Atlas instead of Docker

The app reads its settings from the environment, then from `.env`, then from
the built-in defaults, in that order of priority. A bad value stops startup
with a message naming the setting.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `3000` | Port the API listens on |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/?directConnection=true` | Connection string. Starts with `mongodb://` or `mongodb+srv://` |
| `MONGODB_DB` | `biteexpress` | Database name: 1 to 38 letters, digits, `_` or `-` |
| `MONGO_PORT` | `27017` | Docker Compose only: the port published on your machine for MongoDB |
| `API_PORT` | `3000` | Docker Compose only: the port published on your machine for the API container |

If you change `MONGO_PORT`, change the port inside `MONGODB_URI` to match. If
you change `MONGODB_DB`, note that `npm run db:shell` and `npm run db:inspect`
still open `biteexpress`; use `docker compose exec mongodb mongosh <name>` for
the other name.

To run against an Atlas cluster, put its `mongodb+srv://` string in `.env` as
`MONGODB_URI`. The database user needs the right to create collections and
indexes, including search indexes, because the API creates them at startup. Add
your IP address to the cluster's network access list. The string contains a
password: it belongs in `.env`, never in Git.

### 3.11 Pin the database image

`docker-compose.yml` uses the moving tag `mongodb/mongodb-atlas-local:8.0`. Once
it works for you, pin the exact build so a later pull cannot change behaviour:

```powershell
docker image inspect mongodb/mongodb-atlas-local:8.0 --format "{{index .RepoDigests 0}}"
```

That prints `repository@sha256:<digest>`. In `docker-compose.yml`, change the
line to `image: mongodb/mongodb-atlas-local:8.0@sha256:<digest>`.

## 4. What happens when the API starts

1. `ConfigModule` validates the environment against the Zod schema in
   `src/config/env.schema.ts`.
2. The `MONGO_CLIENT` provider creates one `MongoClient` and connects, giving up
   after 5 seconds. A wrong address or a stopped database ends the process here
   with exit code 1 and a message that starts `Could not connect to MongoDB at`.
   Passwords in the connection string are masked in that message.
3. The `MONGO_DB` provider hands out the database named by `MONGODB_DB`.
4. `SchemaBootstrapService` runs `ensureRestaurantsSchema`:
   - creates the `restaurants` collection with its `$jsonSchema` validator
     (`strict`, `error`), or updates the validator if the collection exists;
   - creates the four indexes by name (a no-op when they already exist);
   - asks for the Atlas Search index, and only logs a warning if the deployment
     cannot do search.
5. Only now does the HTTP server start listening, so the first request always
   finds the schema in place.
6. On Ctrl+C or SIGTERM, Nest runs its shutdown hooks and `DatabaseModule`
   closes the MongoDB connection pool.

## 5. Reading the `/ready` response

`/ready` answers `200` when MongoDB responds and all four expected indexes
exist. Otherwise it answers `503` with the same body, so a person can see why.
Every check has a 2 second limit, so the endpoint cannot hang.

| Field | Meaning |
| --- | --- |
| `status` | `ready` (serve traffic here) or `unavailable` |
| `mongodb.status` | `up` or `down`. `latencyMs` is the time one ping took; `error` explains `down` |
| `indexes.status` | `ok`, `missing` (see `missing` for the names) or `unknown` (could not list them; see `error`) |
| `search.status` | `READY`; `PENDING` or `BUILDING` while it is being built; `FAILED` if the definition was rejected; `MISSING` if no such search index exists; `UNAVAILABLE` if the deployment has no search process or the call failed (see `error`); `UNKNOWN` if MongoDB was down so it was not checked |
| `search.queryable` | `true` once the search index can answer queries |

The search index is reported but never makes the endpoint fail: without it,
search falls back to the rule-based path (arrives with the search step).

## 6. Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `npm run db:up`: "Cannot connect to the Docker daemon" or "docker daemon is not running" | Docker Desktop is not running | Start Docker Desktop, wait for "Engine running", run it again |
| `npm run db:up`: "port is already allocated" or "Bind for 127.0.0.1:27017 failed" | Another MongoDB uses port 27017 | Find it with `Get-NetTCPConnection -LocalPort 27017 -State Listen` and stop it, or set `MONGO_PORT=27018` and `MONGODB_URI=mongodb://127.0.0.1:27018/?directConnection=true` in `.env` |
| `npm run db:up` times out, or says the container is unhealthy | First start is slow, or Docker has too little memory | Run `npm run db:logs` and wait a little. If it keeps failing, raise Docker Desktop's memory limit (about 2 GB for this container) |
| API stops at startup: `Could not connect to MongoDB at ...` | The database is not running, or `MONGODB_URI` is wrong | `docker compose ps`, then `npm run db:up`; check `.env` |
| API stops at startup: `already exists with a different definition` | An index was changed in code but the old one is still in the volume | `npm run db:reset` (deletes local data), then start again |
| API stops at startup: `EADDRINUSE` on port 3000 | Another copy of the API (or the demo container) holds the port | Stop it, or change `PORT` in `.env` |
| `/ready` is `503`, `mongodb.status` is `down` | MongoDB stopped or unreachable after the API started | `docker compose ps`; `docker compose start mongodb` |
| `/ready` is `503`, `indexes.missing` lists names | An index was dropped, or the collection is new | Restart the API: startup recreates them |
| `/ready` is `200` but `search.status` is `UNAVAILABLE` or `MISSING` | The deployment has no search process, or the search index was not created | Look for the warning `Atlas Search index ... was not created` in the API log. Use the Atlas Local image, not a plain `mongo` image. Once the database is healthy, restart the API: startup asks for the search index again |
| `/ready` is `200`, `search.status` `PENDING` or `BUILDING` | The search index is still building | Wait 10 to 60 seconds and ask again |
| `curl` prints a progress table or asks for input | PowerShell's `curl` alias | Use `curl.exe` |
| `npm run test:int` fails with `MongoServerSelectionError` | The database is not running | `npm run db:up` |
| `npm run test:int` was killed and left `biteexpress_it_...` databases behind | The cleanup step did not run | `npm run db:shell`, then `db.adminCommand({ listDatabases: 1 }).databases.map(d => d.name)` and `db.getSiblingDB('biteexpress_it_xxxx').dropDatabase()` for each leftover |
| `docker compose exec ... /scripts/...` fails in Git Bash with a strange Windows path | Git Bash rewrites paths that start with `/` | Use the npm scripts (`npm run db:inspect`), or prefix the command with `MSYS_NO_PATHCONV=1` |
| Database data seems gone | `npm run db:reset` or `docker compose down -v` was run | Expected: that deletes the volumes. Re-run the import (Step 3) |

When you report a problem, include the output of `docker compose ps`, the last
lines of `npm run db:logs`, and the full API error.

## 7. Where things are

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | The `mongodb` service (Atlas Local, data volumes, port bound to 127.0.0.1) and the `api` service for demo mode |
| `Dockerfile`, `.dockerignore` | Multi-stage build of the API image: compile, install production dependencies only, run as the non-root `node` user, health check on `/health` |
| `src/config/env.schema.ts` | Every setting, its type, range and default |
| `src/database/restaurants.collection.ts` | The restaurants validator, the four indexes and the search index definition, as plain data |
| `src/database/schema-bootstrap.ts` | Applies that definition to the database; repeatable and safe from several instances |
| `src/database/schema-bootstrap.service.ts` | Runs the bootstrap once at startup, before the server listens |
| `src/database/mongo-client.factory.ts` | Creates and connects the single `MongoClient`; masks passwords in errors |
| `src/database/database.module.ts` | Provides `MONGO_CLIENT` and `MONGO_DB`; closes the client on shutdown |
| `src/health/health.controller.ts` | `GET /health`: liveness, never touches MongoDB |
| `src/health/ready.controller.ts`, `src/health/readiness.ts` | `GET /ready`: readiness, pings MongoDB and checks the indexes |
| `scripts/mongosh/` | The scripts behind `npm run db:inspect` and `npm run db:validator-demo` |
| `test/support/` | `FakeDb` (stands in for MongoDB in e2e tests), the app builder, and the per-run test-database setup |
| `test/mongo.int-spec.ts` | Integration tests against a real MongoDB |

## 8. Design decisions worth being able to explain

- **Two probes, not one.** `/health` answers "is this process alive?" and never
  touches MongoDB, so a database outage cannot make an orchestrator restart a
  healthy process in a loop. `/ready` answers "can it serve traffic?" and returns
  503 with reasons. Search status is reported but does not fail readiness,
  because search degrades to the rule-based path.
- **Fail fast at startup.** The app connects and prepares the schema before it
  listens. A wrong address stops the process with a clear message and a non-zero
  exit code, which Docker and CI notice, instead of failing the first user request.
- **A repeatable bootstrap.** Create the collection or update its validator,
  create named indexes, request the search index if missing. Running it on every
  start, or from several instances at once, converges to the same result; the
  one race (two instances creating the collection) is handled explicitly.
  Trade-off: the app needs the right to create collections and indexes. A
  production system would run this as a migration job with its own credentials and
  give the API read and write access only.
- **A validator that states what must always be true.** Required fields, types,
  ranges and allowed values, with extra fields allowed, so a newer version of the
  app can add an optional field while an older one is still running. The Zod
  schemas in the API are the first line of defence; the validator is the backstop
  for any other writer, such as a script or a manual edit.
- **`tenantId` leads every index.** A query for one tenant never walks another
  tenant's entries. Compound indexes follow equality, then sort, then range. The
  city listing index ends in `_id` so paging is stable when scores tie. The unique
  index on tenant plus source system plus source id is partial, so restaurants
  created through the API (which have no source) do not collide, and imports can be
  re-run without creating duplicates.
- **Atlas Local for development.** The same MongoDB and Atlas Search engine as
  Atlas, in one container, so `$search` can be developed and tested offline. The
  port is bound to 127.0.0.1 because this local database has no password.
  `directConnection=true` is required because the one-node replica set advertises
  a container hostname that your machine cannot resolve.
- **One `MongoClient` per process.** It owns the connection pool, is created once,
  and is closed on shutdown. Every wait has a limit: 5 seconds to find a server,
  2 seconds per readiness check.
- **Three layers of tests.** Unit tests for logic, HTTP tests with a fake database
  for the API contract, and integration tests against a real MongoDB for what only a
  real server can prove. Each integration run uses its own throwaway database.

## 9. Not covered yet

- The data import (Step 3), the create and fetch endpoints (Step 4), the list
  endpoint (Step 5) and search queries (Step 7) are not part of this step.
- The local database has no authentication. That is acceptable on a laptop with
  the port bound to 127.0.0.1; it is not acceptable anywhere else.
- The Atlas Search index definition is a baseline. The search step extends it with
  the facets it needs.
