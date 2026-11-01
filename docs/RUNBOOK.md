# Runbook: running, checking and testing BiteExpress locally

How to start the database and the API, check that they work, load the
restaurants, look inside MongoDB, run every kind of test, and fix the usual
problems. Commands are written for Windows PowerShell. The `npm` and `docker`
commands work the same in any shell. For the overview and the quick start, see
[README.md](../README.md); for the reasoning behind the design, see
[DECISIONS.md](DECISIONS.md).

## At a glance

| I want to | Command |
| --- | --- |
| Start MongoDB (Atlas Local) in Docker | `npm run db:up` |
| Run the API with auto-reload | `npm run start:dev` |
| Ask "is the process alive?" | `curl.exe -i http://localhost:3000/health` |
| Ask "can it serve traffic?" | `curl.exe -i http://localhost:3000/ready` |
| Create a restaurant (section 3.14) | `curl.exe -i -H "Content-Type: application/json" --data-binary "@docs/examples/create-restaurant.json" http://localhost:3000/v1/restaurants` |
| Fetch it by the id that came back | `curl.exe -i http://localhost:3000/v1/restaurants/<id>` |
| List and filter restaurants (section 3.15) | `curl.exe -s "http://localhost:3000/v1/restaurants?city=Gurgaon&limit=5"` |
| Search with a sentence (section 3.16) | `curl.exe -s "http://localhost:3000/v1/restaurants/search?q=Best%20restaurants%20in%20Gurgaon%20with%20South%20Indian%20Food"` |
| See what the API created in MongoDB | `npm run db:inspect` |
| Open a MongoDB shell | `npm run db:shell` |
| Watch the database refuse bad data | `npm run db:validator-demo` |
| Check that the listing queries use indexes | `npm run db:explain` |
| Run the unit tests | `npm test` |
| Run the HTTP tests (no database needed) | `npm run test:e2e` |
| Run the tests against a real MongoDB | `npm run test:int` |
| Lint, type-check, unit and HTTP tests in one go | `npm run check` |
| Follow the database log | `npm run db:logs` |
| Stop everything, keep the data | `npm run db:down` |
| Delete all local data and start clean | `npm run db:reset` |
| Run the API and the database both in Docker | `npm run stack:up` |
| Clean the sample and print the report, without touching the database | `npm run import:dry` |
| Load the sample (500 restaurants) | `npm run import` |
| Load the full dataset (9,551 restaurants) | `npm run import -- --file data/full/zomato.csv` |
| Load the sample from inside a container | `npm run db:import` |
| Check that `data/text-fixes.json` is current | `npm run import:fixes -- --check` |

## 1. What you need

- Node.js 24.9 or newer: `node --version`.
- Docker Desktop, started and showing "Engine running": `docker compose version`.
- Free ports 27017 (MongoDB) and 3000 (API). Section 3.10 explains how to change them.
- About 2 GB of free memory for the database container. It runs MongoDB and the
  Atlas Search process together.
- Optional, to load the full dataset: the take-home archive unzipped into
  `data/full/` (section 3.12). The 500-row sample needs nothing extra.

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

Later steps are applied the same way. Step 3 adds the importer, the data files
and one dependency (`csv-parse`):

```powershell
Expand-Archive -Path "$HOME\Downloads\step3-overlay.zip" -DestinationPath . -Force
git status
git diff package.json      # should show csv-parse and the four import scripts, nothing else
npm install                # updates package-lock.json: commit it
npm run check              # lint, type-check, unit and HTTP tests
```

`data/.gitignore` keeps the unzipped archive (`data/full/`) out of Git. Nothing
else in `data/` is ignored: the sample and `text-fixes.json` are committed.

Steps 4 and 5 (create and fetch, then list) add no dependency. Apply them the same
way (`step4-overlay.zip`, then `step5-overlay.zip`) and run `npm run check`.
Step 5 changes `package.json` by one script (`db:explain`) and adds one index,
`tenant_score`, which the API creates the next time it starts.

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
LOG [SchemaBootstrapService] Indexes in place: tenant_location_2dsphere, tenant_city_score, tenant_city_cuisine_score, tenant_score, tenant_source_unique
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
    "present": ["_id_", "tenant_location_2dsphere", "tenant_city_score", "tenant_city_cuisine_score", "tenant_score", "tenant_source_unique"],
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
| `npm test` | nothing | Pure logic: config schema, bootstrap call order and error handling, readiness decisions, URI redaction, the collection definition. For the importer: every cleaning rule, the upsert operations, the report, the command line, and the committed sample cleaned for real and checked against the collection validator. For the restaurant API: the request schemas, the error format, the service, the listing rules (query parameters, the MongoDB query builder, the lists of cities and cuisines), the reader of search sentences (about 180 tests on phrases alone) and its merge with the parameters, and the contract checks run on the in-memory store |
| `npm run test:e2e` | nothing | The real Nest app over HTTP with MongoDB faked: routes, status codes, headers, the `/v1` prefix not applying to the probes; creating, fetching, listing and searching restaurants (the three questions of the brief, a sentence together with parameters, the headers), and the error answer of every refusal |
| `npm run test:int` | `npm run db:up` | What only a real server can prove: validator rejections (error 121), indexes exist, bootstrap is repeatable, unique and partial index behaviour, `$geoNear` ordering and distances, `/ready` against the real database. For the importer: the sample imported twice leaves 500 documents and changes only `updatedAt`, two tenants stay apart, one refused restaurant costs one restaurant, the upsert uses `tenant_source_unique`, and the whole command ends in `Result: PASS`. With the archive in `data/full/`, it also imports all 9,551 rows twice. For the restaurant API: the contract checks again on the MongoDB store, the listing queries on 60 real documents (no `COLLSCAN`, the geo index used, distances right), the plans of the searches with words, the three questions of the brief answered from real data, and create, fetch, list and search over HTTP on a real database |
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
| `DEFAULT_TENANT_ID` | `biteexpress` | The tenant that owns the imported restaurants: 1 to 64 letters, digits, `_` or `-`. `npm run import -- --tenant <id>` overrides it for one run |
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

### 3.12 Load the restaurants

The importer reads a Zomato CSV, applies the cleaning rules, writes the result to
MongoDB and prints a report. Three commands, from the safest to the most complete:

```powershell
npm run import:dry                                  # clean and report; never connects to MongoDB
npm run import                                      # load the 500-row sample
npm run import -- --file data/full/zomato.csv       # load the full dataset
```

`npm run import` compiles the project first, then runs it. Everything after `--`
goes to the importer. By default it reads the committed sample and
`data/text-fixes.json`, so it works from a plain clone. The database must be
running for the last two (`npm run db:up`).

Running it again is safe. A restaurant is matched on tenant, source system and
source id (the unique index `tenant_source_unique`), so a second run finds every
restaurant and updates it in place: no duplicates, `createdAt` stays, `updatedAt`
moves to the new run.

**Load the full dataset and check it** (this is the "done when" of Step 3):

1. Unzip the take-home archive into `data/full/`, so that
   `data/full/zomato.csv` exists. Confirm Git ignores it:
   `git check-ignore -v data/full/zomato.csv` prints the rule from
   `data/.gitignore`.
2. Start the database: `npm run db:up`.
3. Run the import twice:

```powershell
npm run import -- --file data/full/zomato.csv
npm run import -- --file data/full/zomato.csv
```

Both runs must end with `Result: PASS`. The first reports `inserted 9,551`; the
second reports `inserted 0, matched 9,551`. Both end the numbers with
`In the collection .......... 9,551 documents, 9,051 with a location`. To look
for yourself, open `npm run db:shell` and run `db.restaurants.countDocuments()`.

**Reading the report:**

```text
Import report
-------------
File ....................... data/sample/zomato-sample.csv
Target ..................... biteexpress.restaurants, tenant "biteexpress"
Rows read .................. 500
Rows imported .............. 500
Rows rejected .............. 0
Texts repaired ............. 70 (166 fixes loaded)
With a location ............ 439
Without a location ......... 61
Rated ...................... 382
Not rated .................. 118
Cost unknown ............... 18
No cuisines ................ 9
Distinct cuisines .......... 91
By country ................. IN 355, US 30, BR 24, TR 20, AE 10, QA 8, ZA 8, ...
Written .................... inserted 500, matched 0, modified 0, failed 0
In the collection .......... 500 documents, 439 with a location

No expected numbers for this file: they exist for the full 9,551-row dataset only.

Result: PASS
```

| Line | Meaning |
| --- | --- |
| Rows read, imported, rejected | Rows in the CSV; rows that passed every rule and were written; rows a rule refused. Up to 10 refused rows are listed with their id and the reason |
| Texts repaired | Restaurants whose name, address, city or locality was replaced from `data/text-fixes.json` (flag `text_repaired`). The number in brackets is how many fixes the file holds |
| With and without a location | Restaurants stored with a GeoJSON point, and those whose source coordinates were unusable (flag `coords_missing`). The latter are kept, but no distance query returns them |
| Rated and not rated | A rating above 0, and a rating of 0, which is stored as no average, no label and no score |
| Cost unknown | A cost for two of 0, stored as `null` |
| No cuisines | Rows whose cuisine list is empty |
| Distinct cuisines | Different cuisine names after cleaning |
| By country | Restaurants per ISO country code |
| Written | What MongoDB did. `inserted`: new documents. `matched`: existing documents the upsert found. `modified`: of those, how many changed (all of them on a rerun, because `updatedAt` moves). `failed`: restaurants the database refused; they are listed with the reason |
| In the collection | What the database holds for this tenant afterwards |

For the full 9,551-row file the report ends with "Checks against the full
dataset". Each line is `[ok]`, or `[FAIL] label: expected X, got Y`. A failed
check, a rejected row or a refused write makes the result `FAIL`.

The exit code says the same thing: `0` for `PASS`, `1` when the run did not
succeed (unreadable file, database unreachable, rejected rows, refused writes, a
failed check), `2` for a wrong command line or configuration. In PowerShell,
`$LASTEXITCODE` shows it. After a non-zero exit, npm adds its own "command
failed" lines; the report above them is what matters.

**Options:**

| Option | Default | Meaning |
| --- | --- | --- |
| `--file <path>` | `data/sample/zomato-sample.csv` | The CSV to import |
| `--text-fixes <path>` | `data/text-fixes.json` | Corrected texts by restaurant id |
| `--tenant <id>` | `DEFAULT_TENANT_ID` (`biteexpress`) | The tenant that owns the data |
| `--batch-size <n>` | `1000` | Restaurants per bulk write, 1 to 10000 |
| `--dry-run` | off | Clean and report only; does not connect to MongoDB |
| `-h`, `--help` | | Show the usage text |

**In a container instead:**

```powershell
npm run db:import                                                       # the sample
docker compose run --rm --build importer --file data/full/zomato.csv    # the full dataset
docker compose run --rm --build importer --dry-run
```

The `importer` service in `docker-compose.yml` is a one-off job in the `tools`
profile, so `docker compose up` never starts it. It builds the same image as the
API, mounts `./data` read-only, reaches the database as `mongodb:27017`, and
starts the database first if it is not running. The first run builds the image,
which takes a few minutes.

**Look at what was loaded:**

```powershell
npm run db:shell
```

```js
db.restaurants.countDocuments()
db.restaurants.findOne({ 'source.id': '308022' })
db.restaurants.find({ dataQuality: 'coords_missing' }, { name: 1, 'address.city': 1 }).limit(5)
db.restaurants.aggregate([
  { $geoNear: { near: { type: 'Point', coordinates: [77.0886879, 28.4952079] }, distanceField: 'meters', query: { tenantId: 'biteexpress' } } },
  { $limit: 5 },
  { $project: { _id: 0, name: 1, city: '$address.city', meters: { $round: ['$meters', 0] } } },
])
```

The last query asks for the five restaurants nearest to Farzi Cafe in Gurgaon. The
first row is Farzi Cafe itself, at 0 metres.

To start over with an empty database, `npm run db:reset` then `npm run db:up`,
then import again.

### 3.13 Rebuild or check the text fixes

`data/text-fixes.json` is committed, so you only need this if you change how
damaged text is detected. It compares the full CSV with the Zomato API dumps in
`data/full/` and writes down the difference:

```powershell
npm run import:fixes -- --check    # change nothing; exit code 1 if the file is out of date
npm run import:fixes               # rewrite data/text-fixes.json if it would change
```

`data/README.md` explains what is damaged in the CSV and why the dumps stay out of Git.

### 3.14 Create and fetch a restaurant

`POST /v1/restaurants` adds a restaurant and returns it. `GET /v1/restaurants/{id}`
returns one restaurant. The request bodies live in `docs/examples/`, so the
commands below work in Windows PowerShell without quoting JSON by hand
(`--data-binary "@file"` sends the file exactly as it is).

```powershell
# Create. The API answers 201 and the new restaurant.
curl.exe -i -H "Content-Type: application/json" --data-binary "@docs/examples/create-restaurant.json" http://localhost:3000/v1/restaurants
```

What to look for in the answer:

```text
HTTP/1.1 201 Created
Location: /v1/restaurants/65a1b2c3d4e5f60718293a4b
X-Request-Id: 0b6c7e0e-1d1f-4a54-9c43-0d3a0f0c7b1e
Content-Type: application/json; charset=utf-8

{
  "id": "65a1b2c3d4e5f60718293a4b",
  "name": "Naivedhyam",
  "address": { "line": "Shop 12, Main Market", "locality": "Sector 29", "city": "Gurgaon",
               "country": { "code": "IN", "name": "India" } },
  "location": { "latitude": 28.4595, "longitude": 77.0266 },
  "cuisines": ["South Indian", "Vegetarian"],
  "cost": { "forTwo": 800, "currency": "INR", "priceRange": 2 },
  "rating": { "average": 4.3, "votes": 4385, "label": "Very Good", "score": 4.2903 },
  "services": { "tableBooking": false, "onlineDelivery": true, "deliveringNow": false },
  "status": "active",
  "dataQuality": [],
  "createdAt": "2026-11-01T10:30:00.000Z",
  "updatedAt": "2026-11-01T10:30:00.000Z"
}
```

(The id and timestamps will differ. The long lines above are wrapped for reading.)
The request did not contain `currency`, `label`, `score`, `status`, the
timestamps or the tenant: the server owns them. The currency comes from the
country, the label and score from the average and the votes (the same formula
the importer uses), and the tenant from the `X-Tenant-Id` header or the
configured default.

Fetch it with the id from `Location`:

```powershell
$created = curl.exe -s -H "Content-Type: application/json" --data-binary "@docs/examples/create-restaurant.json" http://localhost:3000/v1/restaurants | ConvertFrom-Json
curl.exe -i http://localhost:3000/v1/restaurants/$($created.id)
```

The `GET` answer carries `Cache-Control: private, max-age=30`, `Vary: X-Tenant-Id`
and an `ETag`. Ask again with that ETag and the server answers `304 Not Modified`
without a body, which is what a mobile app on a poor connection wants. curl can
store the ETag and send it back for you, which avoids quoting it by hand:

```powershell
curl.exe -s -o NUL --etag-save "$env:TEMP\etag.txt" http://localhost:3000/v1/restaurants/$($created.id)
curl.exe -i --etag-compare "$env:TEMP\etag.txt" http://localhost:3000/v1/restaurants/$($created.id)   # 304
```

**Every error has the same shape** (RFC 9457, `Content-Type: application/problem+json`),
carries the `X-Request-Id` of the request as `requestId`, and is sent with
`Cache-Control: no-store`. Try each of these once:

| Request | Answer | What it shows |
| --- | --- | --- |
| `POST` with `docs/examples/create-restaurant-invalid.json` | `400`, `errors` lists `#/name`, `#/address/countryCode`, `#/cost/priceRange` and `#/tenantId` | Every faulty field in one answer. A field the client does not own (`tenantId`) is refused, not ignored. |
| `POST` the same `create-restaurant-with-source.json` twice | `201`, then `409` with `errors[0].pointer` = `#/source` | The unique index on tenant plus source makes a retry safe. |
| `GET /v1/restaurants/abc` | `400`, `parameter` = `id` | A malformed id is a client mistake, not a 404 and not a 500. |
| `GET /v1/restaurants/000000000000000000000000` | `404` | A well-formed id nobody has. |
| `GET` with `-H "X-Tenant-Id: bad tenant!"` | `400`, `parameter` = `X-Tenant-Id` | The tenant header is validated before it touches a query. |
| `curl.exe -i -H "Content-Type: application/json" --data-binary "{oops" http://localhost:3000/v1/restaurants` | `400`, title `Bad Request` | A parser error is an answer, not a stack trace. |
| `GET /v1/nothing-here` | `404` as a problem document | Unknown routes answer in the same format. |

Swap `latitude` and `longitude` in `create-restaurant.json` and you get a `400` at
`#/location`: "These coordinates are outside India. Check that latitude and
longitude are not swapped." That check applies only to Indian restaurants.

Two tenants in one command (a demo of the tenant boundary):

```powershell
$a = curl.exe -s -H "X-Tenant-Id: acme" -H "Content-Type: application/json" --data-binary "@docs/examples/create-restaurant.json" http://localhost:3000/v1/restaurants | ConvertFrom-Json
curl.exe -s -o NUL -w "%{http_code}`n" -H "X-Tenant-Id: acme"   http://localhost:3000/v1/restaurants/$($a.id)   # 200
curl.exe -s -o NUL -w "%{http_code}`n" -H "X-Tenant-Id: globex" http://localhost:3000/v1/restaurants/$($a.id)   # 404
```

The `X-Tenant-Id` header exists only so that this demo takes one command. Trusting
a header lets any caller act for any tenant; in production the tenant comes from
the caller's verified credential (an API key or a token claim).

See the stored document, and compare it with the answer:

```powershell
npm run db:shell
# then, inside mongosh:
db.restaurants.findOne({ name: "Naivedhyam", tenantId: "biteexpress" })
```

You will see `location` as GeoJSON with longitude first
(`{ type: "Point", coordinates: [77.0266, 28.4595] }`), `tenantId`, `schemaVersion`
and `_id` as an `ObjectId`: the API names the coordinates `latitude` and
`longitude` and hides the rest.

### 3.15 List and filter restaurants

`GET /v1/restaurants` returns one page of restaurants. Every parameter is optional
and goes in the query string. With none, you get the tenant's best-rated
restaurants, 20 to a page.

Start the API and load some restaurants first (`npm run import`). This helper
prints a page as a table; define it once per PowerShell window:

```powershell
$api = "http://localhost:3000/v1/restaurants"
function Show-Restaurants($url) {
  (curl.exe -s $url | ConvertFrom-Json).data |
    Format-Table name, locality, city, averageRating, votes, costForTwo, currency, distanceKm -AutoSize
}
```

(In Windows PowerShell 5.1, accented letters look wrong until you run
`[Console]::OutputEncoding = [Text.Encoding]::UTF8`.)

Some questions to ask. The comments say what the 500-row sample returns:

```powershell
Show-Restaurants "${api}?limit=5"                                                # best rated anywhere
Show-Restaurants "${api}?city=Gurugram&limit=5"                                  # Gurugram is understood as Gurgaon (48 in the sample)
Show-Restaurants "${api}?city=Gurgaon&cuisine=South%20Indian"                    # 1 in the sample, 70 in the full dataset
Show-Restaurants "${api}?city=Gurgaon&currency=INR&maxCost=999&limit=5"          # "under Rs. 1000 for two": 35 in the sample
Show-Restaurants "${api}?lat=28.495&lng=77.089&limit=5"                          # nearest to Cyber Hub, nearest first
Show-Restaurants "${api}?lat=28.495&lng=77.089&radiusKm=3&sort=rating&limit=5"   # best rated within 3 km of Cyber Hub (17 in range)
Show-Restaurants "${api}?city=Gurgaon&currency=INR&sort=cost&limit=3"            # cheapest first
Show-Restaurants "${api}?city=Gurgaon&limit=2&offset=2"                          # the second page of two
```

The nearest-to-Cyber-Hub query should give these five, in this order:

```text
Cherry Comet            Cyber Hub, DLF Cyber City   0.04 km
Farzi Cafe              Cyber Hub, DLF Cyber City   0.04 km
Rred Hot Asian Bistro   Cyber Hub, DLF Cyber City   0.05 km
The Grill Mill          Cyber Hub, DLF Cyber City   0.12 km
Kusum Rolls             DLF Phase 3                 0.6 km
```

The raw answer, for two restaurants (only the first is shown; the `id` will differ):

```powershell
curl.exe -i "${api}?lat=28.495&lng=77.089&limit=2"
```

```text
HTTP/1.1 200 OK
Cache-Control: private, max-age=15
Vary: X-Tenant-Id
X-Request-Id: 5d1c7f0e-61a4-4f43-9a0e-3a9d2b7e1c55
Content-Type: application/json; charset=utf-8

{
  "data": [
    {
      "id": "65a1b2c3d4e5f60718293a4b",
      "name": "Cherry Comet",
      "address": "K-5/A, Near Building 8-B Entrance, Cyber hub, DLF Cyber City, Gurgaon",
      "locality": "Cyber Hub, DLF Cyber City",
      "city": "Gurgaon",
      "country": "India",
      "countryCode": "IN",
      "cuisines": ["Ice Cream", "Desserts"],
      "averageRating": 3.6,
      "votes": 455,
      "costForTwo": 400,
      "currency": "INR",
      "distanceKm": 0.04
    },
    { "...": "the second restaurant, same fields" }
  ],
  "page": { "limit": 2, "offset": 0, "hasMore": true },
  "meta": { "sort": "distance", "order": "asc", "tookMs": 3 }
}
```

How to read it:

- `page.hasMore` says whether another page exists. There is no total on purpose:
  counting every match on every request is a second query, and an app only needs
  to know whether to offer "more".
- `meta.sort` and `meta.order` are the order that was used, so you can see what
  the default was when you did not choose. `meta.tookMs` is the time the server
  spent on the listing.
- The brief's attribute names map to these fields: Id → `id`, Name → `name`,
  Address → `address` (the street line; `locality` is the neighbourhood),
  City → `city`, Country → `country` (`countryCode` is the ISO code),
  Cuisines → `cuisines`, Average Rating → `averageRating` (`null` when nobody
  has rated it), Distance → `distanceKm` (only when `lat` and `lng` were given).

**The parameters**

| Parameter | What it does | Notes |
| --- | --- | --- |
| `name` | The name contains this text, ignoring case | Taken literally: `name=a.b` finds "a.b", not "aXb". Up to 100 characters |
| `city` | The restaurant is in this city | Case and extra spaces do not matter, and well-known other names are understood (`Gurugram` for `Gurgaon`, `Bengaluru` for `Bangalore`). A city nobody has gives an empty page, not an error |
| `country` | The restaurant is in this country | A name or an ISO code: `India`, `IN`, `UK`, `USA` |
| `cuisine` | Serves this cuisine | One name, several separated by commas, or the parameter repeated: `cuisine=Thai,Chinese`. A restaurant matches if it serves any of them; add `cuisineMatch=all` to require all of them. It only filters: every answer still lists all of the restaurant's cuisines |
| `minRating` | The average rating is at least this | 0 to 5, the plain average, not the weighted score. Unrated restaurants never match |
| `minCost`, `maxCost` | The average cost for two is between these, inclusive | Whole numbers, in each restaurant's own currency. Restaurants with no known cost never match |
| `currency` | Only restaurants priced in this currency | Three letters, such as `INR`. Add it whenever you use a cost, or 500 rupees and 500 dirhams count as the same |
| `priceRange` | Zomato's price band | 1 (cheapest) to 4 |
| `delivery`, `booking` | Offers online delivery / takes table bookings | `true` or `false` |
| `lat`, `lng` | Measure the distance from this point | Both or neither. Every item then carries `distanceKm`, and restaurants without coordinates are left out |
| `radiusKm` | Only restaurants within this distance | More than 0, at most 50. Needs `lat` and `lng` |
| `sort` | The order | `rating` (the default), `distance` (the default when `lat` and `lng` are given), `averageRating`, `votes`, `cost`, `name`, `city` |
| `order` | `asc` or `desc` | Every sort has a natural direction (next list); this reverses it |
| `limit`, `offset` | Page size, and where the page starts | `limit` 1 to 50 (default 20); `offset` 0 to 1000 (default 0) |

**How a page is ordered**

- `rating` is a weighted score, not the plain average. It pulls restaurants with
  few votes towards the overall mean, so a 4.9 from 3 votes does not beat a 4.5
  from 3,000. `sort=averageRating` uses the plain average (equal averages: more
  votes first).
- Natural directions: `rating`, `averageRating` and `votes` start with the
  highest; `cost`, `name` and `city` start with the lowest or A; `distance` is
  always nearest first, and `order=desc` with it is refused.
- `order` reverses the whole list, ties included: `order=asc` on a best-first
  list is that list backwards.
- A restaurant with no rating, or no known cost, goes last when the sort runs
  highest first and is left out when it runs lowest first: "no rating" is not
  "the worst rating", and "no cost" is not "free".
- Restaurants with equal values are ordered by id, so paging never shows one
  twice or skips one. (The exception: restaurants at exactly the same point have
  the same distance, and MongoDB does not promise an order among them.)
- `sort=city` goes A to Z by city and, inside each city, best first.
- Distances are in kilometres, rounded to 10 metres.

**What the API refuses.** A bad query is a `400` in the same problem format as
everything else, with one `errors` entry per faulty parameter. A misspelled
parameter is refused rather than ignored, because ignoring it would return an
unfiltered list that looks right.

| Request (after `$api`) | Answer | What it shows |
| --- | --- | --- |
| `?sort=distance` | `400`, `parameter` = `sort` | A distance needs a point to measure from |
| `?lat=28.5` | `400`, `parameter` = `lng` | A point needs both coordinates |
| `?limit=500` | `400`, `parameter` = `limit` | A page has at most 50 restaurants |
| `?minCost=900&maxCost=100` | `400`, `parameter` = `minCost` | An empty range is a mistake, not an empty answer |
| `?minRating=abc&radiusKm=1e3` | `400`, two entries | Every faulty parameter in one answer, each once |
| `?colour=red` | `400`, `Unknown parameter "colour". Remove it.` | A typo is reported |
| `?city=Atlantis` | `200`, `"data": []` | A question with no answers is not an error |

The last operator-injection check needs curl's `-g` (otherwise curl treats the
brackets as a pattern) and single quotes (PowerShell would expand `$ne`):

```powershell
curl.exe -g -s 'http://localhost:3000/v1/restaurants?city[$ne]=x'
```

The answer is a `400` naming the parameter `city[$ne]`. Every value must be plain
text, so a MongoDB operator never reaches the database.

**Check the answers against MongoDB itself**

```powershell
npm run db:shell
# then, inside mongosh:
db.restaurants.countDocuments({ tenantId: "biteexpress", "address.city": "Gurgaon", cuisines: "South Indian" })
# 1 with the sample, 70 with the full dataset
db.restaurants.countDocuments({ tenantId: "biteexpress", "address.city": "Gurgaon", "cost.currency": "INR", "cost.forTwo": { $lte: 999 } })
# 35 with the sample; the API above shows the same restaurants, 20 to a page
```

**Check that every listing query uses an index**

```powershell
npm run db:explain
```

It asks MongoDB how it would run eighteen queries: twelve typical listings (two
of them with the words of a search sentence), four "near me" searches (one of
them with words) and the two that read the lists of cities and cuisines. It
prints one entry for each. Look for `PASS` on every entry and `Result: PASS` at
the end. This is the layout (the plan names are what matter; the keys read,
documents read and milliseconds depend on your data and machine):

```text
Tenant "biteexpress", 500 restaurants.

PASS  a city, best first
        plan:     LIMIT > FETCH > IXSCAN(tenant_city_score)
        returned: 21   keys read: 21   documents read: 21   1 ms
PASS  nearest first
        plan:     GEO_NEAR_2DSPHERE(tenant_location_2dsphere)
        returned: 21   keys read: 21   documents read: 21   1 ms
...
Result: PASS (no query scans the whole collection)
```

A `FAIL` line means that query would read the whole collection (a `COLLSCAN`):
an index is missing or was dropped. Restart the API (startup recreates the
indexes) and run it again. `npm run test:int` runs the same check on the real
queries, so a regression fails the tests before it reaches you.

This check says nothing about how the plans behave with millions of restaurants;
that needs its own measurement. One shape is expected to sort in memory: a city
plus a cuisine reads that city's matching restaurants and sorts them, which at
9,551 restaurants is a few dozen rows.

### 3.16 Search restaurants with a sentence

`GET /v1/restaurants/search` does everything the list does (section 3.15: the
same parameters, the same page, the same order rules, the same refusals) and
also takes a sentence in `q`. These are the three examples of the brief:

- "Best restaurants in Gurgaon with South Indian Food"
- "Restaurants in Gurgaon under Rs. 1000 for two"
- "Nearest place that serves Vada Pav"

The sentence is read by fixed rules, not by a language model (section 8 says
why), and every answer says how it was read, so nothing is guessed in silence.

Start the API and load the restaurants first (`npm run import`). This helper
sends a sentence, prints how it was read, then the restaurants; define it once
per PowerShell window:

```powershell
$search = "http://localhost:3000/v1/restaurants/search"
$cyberHub = "&lat=28.495&lng=77.089"
function Search-Restaurants($sentence, $point = "") {
  $answer = curl.exe -s ("${search}?q=" + [uri]::EscapeDataString($sentence) + $point) | ConvertFrom-Json
  if (-not $answer.interpretation) { $answer | ConvertTo-Json -Depth 5; return }   # a refusal: show it as it is
  "Read as: " + $answer.interpretation.summary
  $answer.interpretation.notes | ForEach-Object { "Note:    " + $_ }
  $answer.data | Format-Table name, locality, city, averageRating, votes, costForTwo, currency, distanceKm -AutoSize
}
```

(Accented letters need the `[Console]::OutputEncoding` line from section 3.15.
To see the headers, or the status of a refusal, use `curl.exe -i` as below.)

Some questions to ask. The comments say how many restaurants match in the
500-row sample and in the full dataset (all matches, not just the first page):

```powershell
Search-Restaurants "Best restaurants in Gurgaon with South Indian Food"     # 1 in the sample, 70 in the full dataset
Search-Restaurants "Restaurants in Gurgaon under Rs. 1000 for two"          # 35 in the sample, 893 in the full dataset
Search-Restaurants "Nearest place that serves Vada Pav" $cyberHub           # none in the sample; 16 in the full dataset, the nearest 0.47 km away
Search-Restaurants "Nearest place that serves Vada Pav"                     # no location: best rated first and a note says why (18 in the full dataset)
Search-Restaurants "top 5 italian places near me" $cyberHub                 # the 5 best rated Italian restaurants within 5 km
Search-Restaurants "pizza rated above 4 within 3 km" $cyberHub              # none in the sample; 2 in the full dataset
Search-Restaurants "restaurants in Dubai under 150 dirhams"                 # 1 in the sample, 5 in the full dataset
Search-Restaurants "cheap street food nearby" $cyberHub                     # cheapest first within 5 km: none in the sample, 35 in the full dataset
```

With the full dataset, "Nearest place that serves Vada Pav" from Cyber Hub gives
these first three (the sample has no restaurant with those words in its name):

```text
Goli Vada Pav No. 1     DLF Phase 3                                   0.47 km
Goli Vada Pav No. 1     Vyapar Kendra, Sushant Lok                    3.94 km
WoW - Vada Pav & More   Sushant Shopping Arcade, Sushant Lok, Gurgaon 3.96 km
```

The raw answer, for the second question with two restaurants (the `id` will differ):

```powershell
curl.exe -i "${search}?q=Restaurants%20in%20Gurgaon%20under%20Rs.%201000%20for%20two&limit=2"
```

```text
HTTP/1.1 200 OK
Cache-Control: private, max-age=15
Vary: X-Tenant-Id
X-Request-Id: 8c0e2f6a-1d93-4b7e-a5c4-6f2d9e8b1a37
Content-Type: application/json; charset=utf-8

{
  "data": [
    {
      "id": "65a1b2c3d4e5f60718293a4b",
      "name": "Crudo Juicery",
      "address": "DLF Phase 3, Gurgaon",
      "locality": "DLF Phase 3",
      "city": "Gurgaon",
      "country": "India",
      "countryCode": "IN",
      "cuisines": ["Beverages", "Salad"],
      "averageRating": 4.3,
      "votes": 33,
      "costForTwo": 400,
      "currency": "INR"
    },
    { "...": "the second restaurant, same fields" }
  ],
  "page": { "limit": 2, "offset": 0, "hasMore": true },
  "meta": { "sort": "rating", "order": "desc", "tookMs": 3 },
  "interpretation": {
    "q": "Restaurants in Gurgaon under Rs. 1000 for two",
    "summary": "Restaurants in Gurgaon, average cost for two at most 999 INR, best rated first",
    "filters": { "city": "Gurgaon", "maxCost": 999, "currency": "INR" },
    "words": [],
    "overridden": [],
    "notes": []
  }
}
```

How to read it:

- `data`, `page` and `meta` are exactly what the list returns (section 3.15).
- `interpretation.summary` is the whole search in one line, written from the
  query that ran, so it cannot disagree with it.
- `interpretation.filters` is what the sentence was turned into, in the names of
  the list's parameters. Send them to `GET /v1/restaurants` and you get the same
  restaurants; a test checks that.
- `interpretation.words` are the words of the sentence that are not a place,
  cuisine or filter. Each one must appear in the restaurant's name or area (below).
- `interpretation.overridden` lists the parameters you sent yourself that took the
  place of something in the sentence.
- `interpretation.notes` are the assumptions, and what could not be answered.
  The third question, from Cyber Hub, says this:

```json
"interpretation": {
  "q": "Nearest place that serves Vada Pav",
  "summary": "Restaurants with \"vada pav\" in the name or area, nearest first",
  "filters": { "sort": "distance" },
  "words": ["vada", "pav"],
  "overridden": [],
  "notes": [
    "\"vada\", \"pav\" are not a city, country, cuisine or filter, so each word must appear in a restaurant's name or area. The data has no menu items to search."
  ]
}
```

**What a sentence can say**

| You write | It means | Notes |
| --- | --- | --- |
| a city of the data: "Gurgaon", "Gurugram", "Delhi" | `city` | Other names of a city are understood as in the list. Delhi is New Delhi |
| a country: "India", "UK", "USA", "UAE" | `country` | Names and nicknames, never the two-letter codes: "in" and "us" are ordinary words |
| a cuisine of the data: "South Indian", "pizza", "street food" | `cuisine` | Whole names. "Indian" is the cuisine Indian, not North Indian |
| "under / below / less than Rs. 1000" | `maxCost=999` | Under means below, so 1000 itself is out |
| "up to / within / at most / budget Rs. 1000" | `maxCost=1000` | |
| "over / above Rs. 500", "at least / from Rs. 500" | `minCost=501`, `minCost=500` | |
| "between 500 and 1500", "Rs 500-1500", "under 1.5k" | `minCost` and `maxCost` | `k` and thousands separators are read |
| "per person" | the amount is doubled | The data prices a meal for two; a note says so |
| "Rs", "₹", "rupees", "$", "dirhams", "AED" and other codes | `currency` | With no currency, costs are compared in each restaurant's own, and a note says so |
| "rated above 4", "4 stars", "4+ rated" | `minRating` | 0 to 5 |
| "within 3 km", "2 miles", "500 m" | `radiusKm` | At most 50. Needs `lat` and `lng` |
| "near me", "nearby", "close by" | `radiusKm=5` | Needs `lat` and `lng`; a note says that 5 km was assumed |
| "nearest", "closest" | `sort=distance` | Needs `lat` and `lng`; the nearest wherever it is, with no radius |
| "best", "top", "top rated" | `sort=rating` | |
| "cheapest", "cheap", "affordable" | `sort=cost`, lowest first | |
| "most expensive" | `sort=cost`, highest first | |
| "popular", "most reviewed" | `sort=votes` | |
| "top 5", "3 nearest", "10 restaurants" | `limit` | At most 50 |
| "with online delivery", "without table booking" | `delivery`, `booking` | |
| "open now", "late night", "24/7" | ignored | Opening hours are not in the data; a note says so |
| anything else | `words` | Up to 6, each must appear in the name or the area |

If two phrases ask for different orders ("cheapest best pizza") the first one is
used and a note names the other.

**Words that are not a place or a filter.** The data has cuisines but no menu, so
"vada pav" cannot be found as a dish. What the API does instead is look for each
word in the restaurant's name and in its area (`locality`), ignoring case, as
plain text, and requires all of them. "vada pav" finds Goli Vada Pav No. 1 and
Vada Pav Junction; it does not find a snack bar that sells vada pav under another
name, and it does not find a restaurant that has only "pav". When nothing
matches, the answer is `200` with an empty page and a note, not `404`. The note
says that fewer words will match more.

**A sentence together with parameters.** All the parameters of section 3.15 work
here, with or without a sentence:

- A parameter you send wins over the sentence, one by one. `q=pizza in Delhi`
  with `city=Pune` is pizza in Pune; `overridden` says `["city"]` and a note
  says so.
- A price is one idea: `minCost` or `maxCost` in the request replaces the whole
  price in the sentence, currency included. `sort` replaces the sentence's order
  and its direction together. `name` replaces nothing: it and the words of the
  sentence both apply.
- A sentence cannot say where you are, so `lat` and `lng` are always parameters.
  Without them, "nearest", "near me" and "within 3 km" are left out and a note
  says that distance was not used. The restaurants come back best rated first.
- `limit` works as in the list: "top 2" is a page of two, with `hasMore` and
  `offset` for the next; `limit` in the request wins.
- A request that contradicts its own sentence is a `400` that names the parameter:
  `order=desc` with "nearest" cannot be done.
- Without `q`, the endpoint is the list, and `interpretation.q` is `null`.

**What the API refuses.** The same problem format as everywhere:

| Request (after `$search`) | Answer | What it shows |
| --- | --- | --- |
| `?q=` | `400`, `parameter` = `q`, `must not be empty` | An empty sentence is not "everything" |
| `?q=pizza&q=pasta` | `400`, `parameter` = `q` | One sentence at a time |
| `?q=` and 201 characters | `400`, `must be at most 200 characters` | A sentence is read up to 200 characters |
| `?qq=pizza` | `400`, `Unknown parameter "qq". Remove it.` | A typo is reported, as in the list |
| `?q=pizza&radiusKm=3` | `400`, `parameter` = `radiusKm`, `needs lat and lng` | A radius of your own needs a point |
| `?q=nearest%20pizza&lat=28.5&lng=77.1&order=desc` | `400`, `parameter` = `order` | The request contradicts its sentence |
| `?q=xyzzy` | `200`, `"data": []`, and a note | A question with no answers is not an error |

**What it does not do.** It is a reader of phrases, and it says when it did not
understand: the words it cannot place are searched in names and areas, which finds
little. It does not know synonyms ("veg" is not "Vegetarian"), moods ("romantic"),
dishes ("dosa" is searched in names, not menus), opening hours, or a rating
upper limit ("rated below 3"). A word that is also the name of a city in the data
is read as the city. Section 9 lists what a later step could add.

**Check the answers against MongoDB itself**

```powershell
npm run db:shell
# then, inside mongosh:
db.restaurants.countDocuments({ tenantId: "biteexpress", status: "active", $and: [
  { $or: [{ name: /vada/i }, { "address.locality": /vada/i }] },
  { $or: [{ name: /pav/i }, { "address.locality": /pav/i }] } ] })
# 0 with the sample, 18 with the full dataset (16 of them have coordinates)
```

That is the query the API builds for "vada pav": one `$or` for each word, joined
by `$and`. `npm run db:explain` shows the plans of the searches with words (section
3.15).

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
   - creates the five indexes by name (a no-op when they already exist);
   - asks for the Atlas Search index, and only logs a warning if the deployment
     cannot do search.
5. Only now does the HTTP server start listening, so the first request always
   finds the schema in place.
6. On Ctrl+C or SIGTERM, Nest runs its shutdown hooks and `DatabaseModule`
   closes the MongoDB connection pool.

## 5. Reading the `/ready` response

`/ready` answers `200` when MongoDB responds and all five expected indexes
exist. Otherwise it answers `503` with the same body, so a person can see why.
Every check has a 2 second limit, so the endpoint cannot hang.

| Field | Meaning |
| --- | --- |
| `status` | `ready` (serve traffic here) or `unavailable` |
| `mongodb.status` | `up` or `down`. `latencyMs` is the time one ping took; `error` explains `down` |
| `indexes.status` | `ok`, `missing` (see `missing` for the names) or `unknown` (could not list them; see `error`) |
| `search.status` | `READY`; `PENDING` or `BUILDING` while it is being built; `FAILED` if the definition was rejected; `MISSING` if no such search index exists; `UNAVAILABLE` if the deployment has no search process or the call failed (see `error`); `UNKNOWN` if MongoDB was down so it was not checked |
| `search.queryable` | `true` once the search index can answer queries |

The search index is reported but never makes the endpoint fail. `GET
/v1/restaurants/search` does not query it yet: it reads the sentence by rule and
uses the ordinary indexes, so it works on any MongoDB (section 3.16).

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
| `/ready` is `503`, `indexes.missing` lists names | An index was dropped, the collection is new, or a step added an index (Step 5 added `tenant_score`) | Restart the API: startup creates what is missing |
| `/ready` is `200` but `search.status` is `UNAVAILABLE` or `MISSING` | The deployment has no search process, or the search index was not created | Look for the warning `Atlas Search index ... was not created` in the API log. Use the Atlas Local image, not a plain `mongo` image. Once the database is healthy, restart the API: startup asks for the search index again |
| `/ready` is `200`, `search.status` `PENDING` or `BUILDING` | The search index is still building | Wait 10 to 60 seconds and ask again |
| `curl` prints a progress table or asks for input | PowerShell's `curl` alias | Use `curl.exe` |
| `npm run test:int` fails with `MongoServerSelectionError` | The database is not running | `npm run db:up` |
| `npm run test:int` was killed and left `biteexpress_it_...` databases behind | The cleanup step did not run | `npm run db:shell`, then `db.adminCommand({ listDatabases: 1 }).databases.map(d => d.name)` and `db.getSiblingDB('biteexpress_it_xxxx').dropDatabase()` for each leftover |
| `docker compose exec ... /scripts/...` fails in Git Bash with a strange Windows path | Git Bash rewrites paths that start with `/` | Use the npm scripts (`npm run db:inspect`), or prefix the command with `MSYS_NO_PATHCONV=1` |
| Database data seems gone | `npm run db:reset` or `docker compose down -v` was run | Expected: that deletes the volumes. Run `npm run import` again |
| `GET /v1/restaurants` answers `400` with `Unknown parameter "..."` | A parameter name is misspelled or not supported | Read the name in the message; section 3.15 lists the parameters |
| `GET /v1/restaurants` answers `200` with an empty `data` for a city you know exists | The restaurants were loaded for another tenant, the import has not run, or the name is spelled differently | `npm run db:inspect` shows what is loaded and for which tenant. Send the same `X-Tenant-Id` the import used (the default is `biteexpress`). Try `name=` with part of a restaurant's name |
| `npm run db:explain` ends in `Result: FAIL` | A listing query would scan the whole collection | Restart the API so that startup recreates the indexes, then run it again. If it persists: `npm run db:reset` and import again |
| `npm run import`: `The import stopped: Could not connect to MongoDB at ...` | The database is not running, or `MONGODB_URI` is wrong | `npm run db:up`; check `.env`. Nothing was written, so run it again |
| `npm run import`: `Result: FAIL` and a `Rejected rows` list | A row broke a hard rule (for example an unknown country code or an empty name). Nothing is skipped silently | Read the ids and reasons. The other rows were written; fix the file and run again |
| `npm run import`: `Result: FAIL` and a `Rows the database refused` list | The collection validator refused a document | The reason names the rule. The rest of the batch was written. Compare the document with `src/database/restaurants.collection.ts` |
| `npm run import`: a `[FAIL]` line under `Checks against the full dataset` | The file is not the take-home `zomato.csv`, it was changed or truncated, or a cleaning rule changed | Compare `expected` with `got`. If you changed a rule on purpose, update `src/importer/expected-report.ts` and the unit test that pins it |
| `npm run import`: `Cannot find module 'csv-parse/sync'` | Dependencies are not installed | `npm install` |
| `npm run import`: `Could not read the CSV file "data/full/zomato.csv"` | The archive is not unzipped there, or the path is wrong | Unzip it so that `data/full/zomato.csv` exists, or pass the right path with `--file` |
| `npm run import`: `The CSV is missing the column(s) ...` | The file is not a Zomato CSV, or its header was changed | The message lists the missing columns and the header it found |
| `npm run import`: `Could not read the text fixes file` | `data/text-fixes.json` is missing or was changed into something that is not valid | Restore it from Git (`git checkout data/text-fixes.json`), or rebuild it with `npm run import:fixes` |
| `git status` lists `data/full/` | `data/.gitignore` is missing | Unzip the Step 3 files again. Never commit the dumps: each record carries an API key |
| API terminal says `Cannot find module '.../dist/...'` right after `npm run import` | Both `start:dev` and `npm run import` build into `dist/`, and the import's build replaced it while the API was restarting | Stop the API and start it again |
| `npm run db:import`: `no such file or directory` for `data/...` | The `./data` folder is not shared with Docker Desktop, or the path after `--file` is wrong | Check Docker Desktop's file sharing. The path is relative to `/app`, so `data/full/zomato.csv` |

When you report a problem, include the output of `docker compose ps`, the last
lines of `npm run db:logs`, and the full API error.

## 7. Where things are

| Path | Purpose |
| --- | --- |
| `README.md` | The overview: quick start, the three questions of the brief, the API, the architecture, the data, the tests, the assumptions and the AI disclosure |
| `docs/DECISIONS.md` | Why it is built this way: every decision with its trade-off, and the migration, scale, security and compliance story, with what is built and what is only described |
| `docker-compose.yml` | The `mongodb` service (Atlas Local, data volumes, port bound to 127.0.0.1), the `api` service for demo mode and the `importer` job (profile `tools`) |
| `Dockerfile`, `.dockerignore` | Multi-stage build of the API image: compile, install production dependencies only, run as the non-root `node` user, health check on `/health` |
| `src/config/env.schema.ts` | Every setting, its type, range and default |
| `src/database/restaurants.collection.ts` | The restaurants validator, the five indexes and the search index definition, as plain data |
| `src/database/schema-bootstrap.ts` | Applies that definition to the database; repeatable and safe from several instances |
| `src/database/schema-bootstrap.service.ts` | Runs the bootstrap once at startup, before the server listens |
| `src/database/mongo-client.factory.ts` | Creates and connects the single `MongoClient`; masks passwords in errors |
| `src/database/database.module.ts` | Provides `MONGO_CLIENT` and `MONGO_DB`; closes the client on shutdown |
| `src/health/health.controller.ts` | `GET /health`: liveness, never touches MongoDB |
| `src/health/ready.controller.ts`, `src/health/readiness.ts` | `GET /ready`: readiness, pings MongoDB and checks the indexes |
| `src/importer/` | The importer. `clean-row.ts` holds every cleaning rule, `import-restaurants.ts` batches and counts, `mongo-restaurant-sink.ts` builds the upserts, `import-report.ts` and `expected-report.ts` print and check the report, `import-cli.ts` reads the command line and `main.ts` is the entry point |
| `src/importer/*.spec.ts` | Unit tests for each of those. `sample-data.spec.ts` cleans the committed sample for real and checks it against known numbers and the collection validator |
| `data/` | The 500-row sample and `text-fixes.json`; `full/` is for the unzipped archive and is ignored by Git. `data/README.md` explains each file |
| `scripts/mongosh/` | The scripts behind `npm run db:inspect`, `npm run db:validator-demo` and `npm run db:explain` |
| `src/http/` | Everything shared by the HTTP layer. `problem.ts` decides how every failure is reported (RFC 9457), `problem-details.filter.ts` writes it, `request-context.ts` gives each request an id and an access-log line, `zod-validation.pipe.ts` turns Zod errors into field errors, `tenant.ts` reads the tenant header, `api-prefix.ts` holds `v1` |
| `src/restaurants/` | The restaurant resource. `create-restaurant.schema.ts` is the request contract, `build-restaurant.ts` turns a request into the stored document, `restaurant.resource.ts` turns a stored document into the answer, `restaurants.service.ts` holds the use cases, `restaurant.store.ts` is the storage port and `mongo-restaurant.store.ts` its MongoDB adapter, `restaurants.controller.ts` is the HTTP glue. For the listing: `list-query.schema.ts` is the contract of the query string, `list-criteria.ts` turns it into what the store is asked, `mongo-list-query.ts` builds the MongoDB query (pure, so it is unit-tested without a database), `restaurant.list-item.ts` shapes each answer, and `vocabulary*.ts` knows the tenant's cities and cuisines, and the other names of a city. For the search: `search-text.ts` reads a sentence into list parameters (pure, one rule per kind of phrase), `search-query.ts` merges them with the request's own parameters and writes the one-line summary, and `restaurant.search-response.ts` is the shape of the answer |
| `test/support/` | `FakeDb` (stands in for MongoDB in e2e tests), the app builder, the per-run test-database setup, `InMemoryRestaurantStore`, `in-memory-listing.ts` (its independently written filtering and ordering) and `restaurant-store.contract.ts` (the checks both stores must pass) |
| `test/restaurants.e2e-spec.ts`, `test/search.e2e-spec.ts`, `test/restaurants.int-spec.ts` | Create, fetch, list and search through the whole HTTP stack with no database (the first two), and against a real MongoDB (the last) |
| `test/mongo.int-spec.ts` | Integration tests against a real MongoDB |
| `test/importer.int-spec.ts` | Integration tests for the importer against a real MongoDB |
| `test/support/zomato-rows.ts`, `test/support/json-schema-lite.ts` | A builder for CSV rows, and a small checker that says whether the collection validator would accept a document, so `npm test` can prove it without a database |

## 8. Design decisions worth being able to explain

- **Two probes, not one.** `/health` answers "is this process alive?" and never
  touches MongoDB, so a database outage cannot make an orchestrator restart a
  healthy process in a loop. `/ready` answers "can it serve traffic?" and returns
  503 with reasons. Search status is reported but does not fail readiness,
  because the search endpoint works without the Atlas Search index.
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
- **The importer is a command, not part of the API.** It is a one-off job with no
  HTTP surface, run from a terminal or from a container, so a failed import cannot
  take the API down. It shares the settings schema and the collection definition
  with the API, so both agree on database, tenant and shape.
- **Cleaning is pure, writing is in one place.** `cleanRow` turns a CSV row into a
  restaurant, or into the reason it is refused, using no database and no clock. A
  small sink interface hides MongoDB, so the same code serves the dry run, the
  real run and the tests.
- **Idempotent by key.** The import upserts on tenant, source system and source
  id instead of clearing the collection first. A rerun updates in place, keeps
  `createdAt` (`$setOnInsert`) and leaves fields the importer does not own alone.
  Trade-off: `updatedAt` moves on every run, so a rerun reports every document as
  modified. A content hash would avoid that; it is not worth it for 9,551 rows.
- **Bad data stays visible.** Unusable coordinates keep the restaurant but drop
  `location` and add the flag `coords_missing`; repaired text adds `text_repaired`.
  A row that breaks a hard rule is rejected and listed, never dropped silently.
- **One bad row costs one row.** Writes are unordered bulk upserts of up to 1,000.
  If the collection validator refuses a document, the rest of the batch is still
  written and the refused one is reported by source id.
- **Expected numbers are part of the tool.** The full dataset has a known shape
  (9,551 rows, 166 repaired texts, 9,051 with a location, and so on). The report
  compares a run with it, so a changed rule, a truncated file or a wrong encoding
  fails loudly instead of loading quietly different data. This applies only to the
  full file, which is recognised by its row count.
- **Repair damaged text from a reference, never by guessing.** The CSV is read
  byte for byte as Latin-1. Damaged letters are replaced from `text-fixes.json` by
  restaurant id, built once from the API dumps, because a rule that guesses
  could corrupt a name that was correct.

- **One error format, decided in one place.** Every failure is an RFC 9457
  `application/problem+json` document with a stable `type`, the HTTP status, a
  `detail`, the request's `instance` and `requestId`, and for validation a list of
  `errors` that point at the faulty field with a JSON Pointer (`#/address/city`) or
  name the faulty parameter. One global filter writes it; `toErrorResponse` in
  `problem.ts` decides what it says, so the rules are unit-tested without HTTP. A
  bug answers a generic 500 that only quotes the request id; the log has the
  real error. Trade-off: services throw exceptions that carry HTTP semantics.
  With two services and no second transport, a domain-error layer plus a
  translation table would cost more than it saves.
- **A body someone shaped on purpose is respected.** `/ready` throws a 503
  whose body is its report. The filter recognises a Nest exception whose body does
  not have Nest's standard shape and sends it untouched, so adding a global
  filter did not change an existing contract.
- **Strict request schemas.** Every object in the create body is strict: a field
  the contract does not name (`tenantId`, `createdAt`, `rating.score`, a typo,
  `__proto__`) is a 400, never silently dropped. A client cannot write what it
  does not own, and a typo is reported instead of becoming a missing value.
- **The server owns derived data.** Currency comes from the country, the label and
  the weighted score from the average and the votes, `dataQuality` from whether
  coordinates exist, timestamps and status from the server. The formulas are the
  importer's, so a restaurant created through the API ranks exactly like an
  imported one.
- **The API says `latitude` and `longitude`; the database says GeoJSON.** The
  one place where the order flips (`[longitude, latitude]`) is `build-restaurant.ts`
  on the way in and `restaurant.resource.ts` on the way out, both tested.
- **A duplicate is the database's decision.** Creating a restaurant with a source
  that the tenant already has is refused by the unique index (error 11000, mapped
  to a 409), not by a read followed by a write, which two concurrent requests
  could both pass.
- **Another tenant's id is a 404.** A 403 would confirm that the id exists.
- **A strict id.** A restaurant id is the `ObjectId` as 24 hexadecimal characters.
  The check is a regular expression, because `new ObjectId("restaurantXY")`
  accepts any 12-character string.
- **Cache what is safe to cache.** A successful `GET` is `private, max-age=30`
  with an ETag and `Vary: X-Tenant-Id`; errors are `no-store`. The headers are set
  after the lookup, so a failure is never cached.
- **Storage behind a port, and a contract that keeps the fake honest.** The service
  talks to a `RestaurantStore`. Tests use an in-memory store; production uses the
  MongoDB one. The same contract tests run against both (`npm test` and
  `npm run test:int`), so the stand-in cannot drift from the real thing.
- **The tenant header is a demo.** See section 3.14. It is validated like any other
  input and documented as the part to replace with a credential.
- **Listing parameters are explicit, and strictly checked.** The list accepts the
  parameters of section 3.15 and nothing else: an unknown one is a 400, never
  ignored, so a typo cannot return an unfiltered list that looks right. Every value
  must be plain text before it is converted, so `?city[$ne]=x` cannot become a
  MongoDB operator, and the name filter is escaped, so a dot in a search means a
  dot. The tenant and `status: active` are added by the query builder, never by the
  caller. Trade-off: less freedom than a query language; in return nothing a client
  sends can change what the database is asked to do.
- **"Best" means the weighted score.** A restaurant rated 4.9 by three people
  should not outrank one rated 4.5 by three thousand. The default order uses the
  stored weighted score (the importer's formula: the average pulled towards the
  overall mean of 3.44 by the equivalent of 50 votes). The plain average stays
  available (`sort=averageRating`, `minRating`) because people also ask for "4 or
  more".
- **Missing is not zero.** MongoDB sorts a missing value as the smallest, so
  `sort=cost` would start with restaurants whose cost nobody knows and an
  ascending rating sort would start with the unrated ones. The listing puts them
  last when the sort runs highest first and leaves them out when it runs lowest
  first.
- **A cost is compared inside one currency.** The dataset prices a meal in local
  currency (rupees, dirhams, pula), so a bare `maxCost=1000` would compare rupees
  with pesos. Add `currency` to the filter; the API does not convert. Trade-off:
  there is no exchange-rate source to trust, and a conversion would hide the unit
  the data actually has.
- **Offset paging with a ceiling, and no total.** A page has 50 restaurants at
  most and an offset stops at 1,000, because MongoDB walks past every skipped
  entry, so the cost of a deep page grows with the offset. `hasMore` comes from
  asking for one row more than the page, which is free; a total would be a second
  query on every request. Trade-off: an app cannot jump to page 500 or print "1 to
  20 of 9,551". The next step, when a feed needs to scroll without limit, is
  keyset paging; every order already ends in `_id`, which is what makes it possible.
- **Pages do not shift.** Every order ends in `_id`, and reversing `order` reverses
  the whole list, ties included. A restaurant is never shown twice, or skipped,
  because two had the same score.
- **The database measures distance.** `$geoNear` on a `2dsphere` index returns
  nearest first with the distance in metres, and stops after one page, so the
  application never loads restaurants to measure them. The index leads with
  `tenantId` and the query carries it, so one tenant's search never reads another's
  entries. A restaurant without coordinates cannot be near anything, so it is left
  out, not guessed.
- **Cities and cuisines are learned from the data.** Two aggregations list the
  tenant's cities and cuisines with counts, cached for 60 seconds and reset when a
  restaurant is created. This is how `city=gurugram` becomes `Gurgaon` and how the
  search recognises "South Indian" inside a sentence. The few well-known
  alternative city names are a short built-in table that applies only when the data
  actually has one of the names. Trade-off: a cache to keep right; the alternative
  is a hard-coded list that goes stale.
- **A short browser cache for listings.** `private, max-age=15` absorbs the
  repeated "restaurants near me" taps of one app during a rush without making the
  server do the work again. Trade-off: a restaurant created a moment ago can be
  missing for up to 15 seconds from an app that has the answer cached. Errors are
  never cached.
- **The response uses the brief's attributes in camelCase.** `Average Rating` is
  `averageRating`, `Distance` is `distanceKm`. JSON clients expect camelCase; the
  mapping is written in section 3.15. If a consumer needs the brief's exact
  spelling, `restaurant.list-item.ts` is the one place to change.
- **The plans are checked, not assumed.** `npm run db:explain` and the integration
  test ask MongoDB for the plan of each listing query and fail on a collection
  scan. A new filter that silently stops using its index becomes a failing test.

- **A sentence is read by rules, and the reading is shown.** `parseSearchText` is
  a pure function: a sentence and the tenant's cities and cuisines in, list
  parameters out, with no database, clock or network. Every kind of phrase (a
  price, a rating, a distance, a count, a word for the order, a service) is one
  rule that cuts its words out of the sentence; what is left is looked up in the
  data's own names. Why not a language model: the same sentence always gives the
  same answer, each rule is tested word by word, there is no latency, cost, key or
  data leaving the system, and it runs offline in Docker Compose. Trade-off: it
  understands the phrases it has rules for, not everything a person could say, and
  it does not know synonyms. Because the reader is one function with a fixed
  output, a model could replace it later without changing the endpoint, the merge
  or the queries.
- **The search is the list.** The sentence becomes the list's parameters and the
  same store query runs; the answer is the list's answer plus `interpretation`.
  So "can do everything the above endpoint does" holds by construction, filters,
  order, paging and the index plans are the ones already tested and explained, a
  sentence can never ask for something the parameters cannot, and a test checks
  that a search returns what the list returns for `interpretation.filters`.
- **Say what was assumed.** Each guess becomes a note in the answer: the cost is
  for two, so "per person" was doubled; no currency was named; "near me" was
  read as 5 km; opening hours are not in the data. The alternative, a silent
  best guess, looks right and cannot be checked.
- **A parameter beats the sentence, field by field.** A sentence is a convenience;
  a parameter is an instruction. A price (min, max and currency) and a sort (with
  its direction) are each one idea, so they are replaced together. `overridden`
  and a note say what was replaced. A request that contradicts its own sentence
  (`order=desc` with "nearest") is a 400 that names the parameter.
- **A sentence cannot say where you are.** `lat` and `lng` are parameters. Without
  them "nearest", "near me" and "within 3 km" are left out with a note, and the
  restaurants come back best rated first, rather than a refusal: a search box
  should answer.
- **"Near me" is 5 km; "nearest" has no limit.** Without a radius, "top 5 italian
  places near me" was the five best rated Italian restaurants anywhere, thousands
  of kilometres away. "Nearest" asks for the closest one, wherever it is, so it
  gets no radius. An explicit distance, in the sentence or in `radiusKm`, wins.
- **Words that are not a place or a filter are looked for in the name and the
  area, all of them.** The data has cuisines but no menu items, so "vada pav"
  cannot be found as a dish; the honest equivalent is names and areas, and the
  answer says so in a note. Each word is a case-insensitive literal substring
  (escaped, so a dot is a dot), and every word must be there, because "vada pav"
  must not return every restaurant with "pav". At most six words, and a sentence
  of at most 200 characters, bound the query. Trade-off: an unanchored match
  cannot use an index; the tenant prefix narrows the scan, which is fine at
  9,551 restaurants. At millions, this is what Atlas Search is for.
- **Whole names for cuisines, nothing guessed.** "Indian" is the cuisine Indian,
  not North Indian, and a two-letter country code is never read from a sentence
  ("in" and "us" are words). A word that fits nothing is searched as a word and
  reported, not mapped to the nearest thing.
- **The search route is declared before `{id}`.** Nest registers routes in the
  order of the methods, so `GET /v1/restaurants/search` would otherwise be a
  lookup of the restaurant "search". A test pins it.
- **The search has the list's cache header.** `private, max-age=15` with
  `Vary: X-Tenant-Id`, set only after the search succeeded; refusals are `no-store`.

## 9. Not covered yet

- The search reads phrases by rule. It does not know synonyms ("veg" for
  Vegetarian), moods ("romantic"), a rating upper limit ("rated below 3") or
  anything about opening hours ("open now" is ignored, with a note). A word it
  cannot place is searched in names and areas, which usually finds nothing.
  Atlas Search (typo tolerance, relevance ranking, autocomplete) or a model-based
  reader would be the next step; the endpoint would not change.
- There is no menu in the data, so "vada pav" matches names and areas that contain
  the words (18 restaurants in the full dataset, none in the sample), not
  restaurants that sell it.
- Words in a sentence are matched as plain substrings of the name and the area,
  which cannot use an index. The tenant prefix narrows the scan; it would not at
  millions of restaurants.
- "Delhi NCR" is understood as New Delhi only; Gurgaon and Noida are cities of
  their own in the data.
- A listing has no total count, only `hasMore`, and an offset stops at 1,000.
  Browsing deeper needs keyset paging.
- A point with a sort other than distance and no `radiusKm` reads every restaurant
  that has coordinates (about 9,000 here), then sorts them. That is fine at this
  size; at millions such a query needs a default radius.
- Restaurants at exactly the same point have the same distance, and MongoDB does
  not promise an order among them, so their order can differ between pages.
- The alternative names of a city (Gurugram, Bengaluru and so on) are a short
  built-in table, not something to edit per tenant.
- Cost filters compare within one currency; there is no conversion.
- One query shape, a city plus a cuisine, sorts its matches in memory, because the
  index for it does not end in `_id`. Changing an existing index needs a migration,
  and a city's worth of restaurants is small.
- Restaurants cannot be updated or deleted through the API; the brief asks for
  create and read only.
- There is no authentication. The tenant comes from a header (demo only).
- The importer never deletes. A restaurant that disappears from the CSV stays in
  the database; there is no mode that removes what a file no longer lists.
- The image URL, menu URL and zip code that the API dumps carry are not imported
  (see `data/README.md`). The validator allows them, so adding them later needs no
  migration.
- The local database has no authentication. That is acceptable on a laptop with
  the port bound to 127.0.0.1; it is not acceptable anywhere else.
- The Atlas Search index definition is a baseline, and nothing queries it yet. A
  `$search` query for typo tolerance and relevance ranking, with the rule-based
  path as the fallback, would extend it.
