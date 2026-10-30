// Shows the database refusing bad data. Safe to run any time: it copies the live
// validator onto a scratch collection called validator_demo and never touches
// the restaurants collection.
//
// Run it from the repository root with:   npm run db:validator-demo
// (docker-compose.yml mounts this folder into the database container as
// /scripts, and the npm script runs this file there with mongosh.)
(function () {
  const info = db.getCollectionInfos({ name: 'restaurants' })[0];
  if (!info) {
    print('Start the API once so it creates the restaurants collection, then run this again.');
    return;
  }

  const scratchName = 'validator_demo';
  db.getCollection(scratchName).drop();
  db.createCollection(scratchName, {
    validator: info.options.validator,
    validationLevel: 'strict',
    validationAction: 'error',
  });
  const scratch = db.getCollection(scratchName);

  const now = new Date();
  const good = {
    tenantId: 'demo',
    // NumberInt makes the whole number explicit: the validator wants a 32-bit integer here.
    schemaVersion: NumberInt(1),
    name: 'Demo Cafe',
    address: { city: 'Gurgaon' },
    cuisines: ['Cafe'],
    services: { tableBooking: false, onlineDelivery: false, deliveringNow: false },
    status: 'active',
    dataQuality: [],
    createdAt: now,
    updatedAt: now,
  };

  function attempt(label, doc) {
    try {
      scratch.insertOne(doc);
      print('ACCEPTED  ' + label);
    } catch (error) {
      print('REJECTED  ' + label + '   [' + error.code + '] ' + error.message);
    }
  }

  function without(doc, field) {
    const copy = Object.assign({}, doc);
    delete copy[field];
    return copy;
  }

  attempt('a valid minimal restaurant', Object.assign({}, good));
  attempt('missing tenantId', without(good, 'tenantId'));
  attempt('status archived (only active or inactive)', Object.assign({}, good, { status: 'archived' }));
  attempt('longitude 200 (must be -180 to 180)', Object.assign({}, good, { location: { type: 'Point', coordinates: [200, 10] } }));
  attempt('priceRange 9 (must be 1 to 4)', Object.assign({}, good, { cost: { priceRange: NumberInt(9) } }));
  attempt('an extra field the schema does not list', Object.assign({}, good, { favouriteDish: 'Vada Pav' }));

  scratch.drop();
  print('(scratch collection removed)');
})();
