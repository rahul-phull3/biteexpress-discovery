// Read-only. Prints what the API created in the restaurants collection:
// the validator, the indexes, the search index and the document count.
//
// Run it from the repository root with:   npm run db:inspect
// (docker-compose.yml mounts this folder into the database container as
// /scripts, and the npm script runs this file there with mongosh.)
(function () {
  const info = db.getCollectionInfos({ name: 'restaurants' })[0];
  if (!info) {
    print('The restaurants collection does not exist yet. Start the API once and run this again.');
    return;
  }

  const options = info.options || {};
  const schema = options.validator && options.validator.$jsonSchema;
  print('--- validator');
  print('level:    ' + options.validationLevel);
  print('action:   ' + options.validationAction);
  print('required: ' + (schema ? schema.required.join(', ') : '(none)'));

  print('--- indexes');
  db.restaurants.getIndexes().forEach(function (ix) {
    let line = ix.name + '  ' + JSON.stringify(ix.key);
    if (ix.unique) line += '  unique';
    if (ix.partialFilterExpression) line += '  partial ' + JSON.stringify(ix.partialFilterExpression);
    print(line);
  });

  print('--- search indexes');
  try {
    const search = db.restaurants.getSearchIndexes();
    if (search.length === 0) print('(none)');
    search.forEach(function (ix) {
      print(ix.name + '  status=' + ix.status + '  queryable=' + ix.queryable);
    });
  } catch (error) {
    print('not available on this deployment: ' + error.message);
  }

  print('--- documents');
  print(db.restaurants.estimatedDocumentCount());
})();
