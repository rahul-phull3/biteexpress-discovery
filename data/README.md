# Data files

What is in this folder, where it comes from, and what stays out of Git.

| Path | In Git | What it is |
| --- | --- | --- |
| `sample/zomato-sample.csv` | yes | 500 rows copied unchanged from the take-home `zomato.csv`. The default input of `npm run import`: small enough to read, and it contains every kind of awkward row. |
| `text-fixes.json` | yes | The correct name, address, city or locality for the 166 restaurants whose text is damaged in the CSV. Read by every import. Rebuilt by `npm run import:fixes`. |
| `full/` | **no** (ignored) | Where you unzip the take-home archive: `zomato.csv` (9,551 rows), `file1.json` to `file5.json` (Zomato API dumps) and `Country-Code.xlsx`. |

`full/` is listed in `data/.gitignore`. After unzipping, confirm it with
`git check-ignore -v data/full/zomato.csv`: it should print the rule that ignores the file.

## What is wrong with the CSV

These are the reasons the importer cleans the data instead of copying it.

- **Damaged text.** The file is read as Latin-1, and in some rows the accented
  letters are already damaged: Café Daniel Briand in Brasília arrives as
  `Cafí© Daniel Briand` in `Brasí_lia`. 166 restaurants are affected. The API
  dumps hold the correct text for the same restaurant ids, so `text-fixes.json`
  records the correct value for each damaged field, and the importer applies it
  by restaurant id.
- **Unusable coordinates.** 500 rows have no usable position: 497 at exactly
  0, 0 (a point in the Atlantic, not a place), 2 with one coordinate at 0, and 1
  Indian row that lies outside India. Those restaurants are kept, but get no
  `location` and a `coords_missing` flag.
- **Ratings of 0.** 2,148 rows have rating 0, which means "not rated", not "terrible".
  The importer stores no average, no label and no score for them.
- **Cost of 0.** Means "unknown", stored as `null`.
- **Untidy text.** Line breaks and runs of spaces inside addresses and names are
  collapsed to single spaces; cuisines are split, tidied and de-duplicated.
- **Two wrong country names** in the workbook (Philippines, United Arab Emirates) are
  corrected in `src/importer/countries.ts`.

`npm run import` prints these counts for the file it read, and for the full file
compares them with the expected numbers.

## The text fixes

`text-fixes.json` maps a restaurant id to the fields that need replacing:

```json
{
  "6601005": {
    "name": "Café Daniel Briand",
    "address": "SCLN 104, Bloco A, Loja 26, Asa Norte, Brasília",
    "city": "Brasília"
  }
}
```

It is derived data, and it is checked in so that the importer works from a plain
clone, without the 55 MB of dumps. To rebuild it, or to prove it is current, unzip
the archive into `data/full/` and run:

```powershell
npm run import:fixes             # rewrite data/text-fixes.json if it would change
npm run import:fixes -- --check  # change nothing; exit code 1 if the file is out of date
```

The tool copies four text fields per restaurant out of the dumps. It does not read,
print or store anything else from them, the API key included.

## The sample

`sample/zomato-sample.csv` is a seeded random selection (seed 20261030), so the same
rows come out every time. It always includes the restaurants the project plan uses as
examples (Farzi Cafe, Rangrezz Restaurant, Café Daniel Briand, Sandubas Café), then a
share of every difficult kind of row (damaged text, zero coordinates, rating 0 with and
without votes, cost 0, no cuisines, a line break inside an address, a repeated cuisine,
an untrimmed name), up to five restaurants from each of the 15 countries (Canada has
only four in the whole file) and the most voted restaurants, and fills up to 500 rows
with random ones.

The rows are copied byte for byte. The unit tests (`src/importer/sample-data.spec.ts`)
check the sample against known numbers, and `.gitattributes` keeps Git from touching
its line endings.

## What the importer does not load

The API dumps also carry an image URL, a menu URL and a zip code. The importer ignores
them on purpose: the CSV is the single source for each restaurant, the dumps only repair
its text, and nothing the API offers (discovery by location, cuisine, rating and cost)
needs those three fields. `media` and `address.zipcode` are optional in the collection
validator, so they can be added later without a migration.

## Licence

The CSV and the dumps come from the take-home archive. The sample is a small excerpt of
it. Before publishing more of the data than this sample, check the licence of the
original dataset on its source page.
