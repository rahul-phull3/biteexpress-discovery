// Read-only. Shows how MongoDB runs the main listing queries of the API: the
// stages and indexes of the winning plan, and how many index keys and documents
// it had to read to return one page. A line starts with PASS when the plan has
// no collection scan (COLLSCAN), FAIL when it has one.
//
// Run it from the repository root, after importing the data, with:
//     npm run db:explain
// It looks at the tenant "biteexpress". For another tenant:
//     docker compose exec -T -e TENANT_ID=my-tenant mongodb mongosh biteexpress --quiet --file /scripts/explain.js
//
// The shapes below are the ones src/restaurants/mongo-list-query.ts builds; the
// integration test test/restaurants.int-spec.ts checks the real builder output.
(function () {
  const tenantId = (typeof process !== 'undefined' && process.env && process.env.TENANT_ID) || 'biteexpress';
  const PAGE = 21; // a page of 20, plus the one extra row that tells whether another page follows
  const active = { tenantId: tenantId, status: 'active' };
  const withFilter = function (extra) {
    return Object.assign({}, active, extra);
  };
  const bestFirst = { 'rating.score': -1, _id: 1 };
  const cyberHub = { type: 'Point', coordinates: [77.089, 28.495] }; // longitude first

  const finds = [
    ['the default listing (whole tenant, best first)', active, bestFirst],
    ['a city, best first', withFilter({ 'address.city': 'Gurgaon' }), bestFirst],
    ['a city and a cuisine, best first', withFilter({ 'address.city': 'Gurgaon', cuisines: { $in: ['South Indian'] } }), bestFirst],
    ['a city, under 1000 rupees, best first', withFilter({ 'address.city': 'Gurgaon', 'cost.currency': 'INR', 'cost.forTwo': { $lte: 999 } }), bestFirst],
    ['a country, best first', withFilter({ 'address.country.code': 'IN' }), bestFirst],
    ['rated 4 or more, best first', withFilter({ 'rating.average': { $gte: 4 } }), bestFirst],
    ['a part of a name, best first', withFilter({ name: { $regex: 'vada', $options: 'i' } }), bestFirst],
    ['cheapest first', withFilter({ 'cost.forTwo': { $ne: null } }), { 'cost.forTwo': 1, _id: 1 }],
    ['by name', active, { name: 1, _id: 1 }],
    ['by city, best first inside each city', active, { 'address.city': 1, 'rating.score': -1, _id: 1 }],
  ];

  const geoNear = function (extra, query) {
    return { $geoNear: Object.assign({ near: cyberHub, distanceField: 'distanceMeters', spherical: true, query: query }, extra) };
  };
  const aggregations = [
    ['nearest first', [geoNear({}, active), { $limit: PAGE }]],
    ['nearest vada pav', [geoNear({}, withFilter({ name: { $regex: 'vada', $options: 'i' } })), { $limit: PAGE }]],
    ['within 3 km, best first', [geoNear({ maxDistance: 3000 }, active), { $sort: bestFirst }, { $limit: PAGE }]],
    ['vocabulary: cities', [{ $match: active }, { $group: { _id: '$address.city', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]],
    ['vocabulary: cuisines', [{ $match: active }, { $unwind: '$cuisines' }, { $group: { _id: '$cuisines', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]],
  ];

  // The stage names of a plan, outermost first: "LIMIT > FETCH > IXSCAN(tenant_city_score)".
  // Newer servers wrap the classic plan in `queryPlan`; both layouts are read.
  const stagesOf = function (plan, out) {
    out = out || [];
    if (!plan) return out;
    if (plan.queryPlan) return stagesOf(plan.queryPlan, out);
    out.push(plan.stage + (plan.indexName ? '(' + plan.indexName + ')' : ''));
    if (plan.inputStage) stagesOf(plan.inputStage, out);
    (plan.inputStages || []).forEach(function (stage) {
      stagesOf(stage, out);
    });
    return out;
  };

  // An aggregation explains as { stages: [ { $cursor | $geoNearCursor: {...} }, ... ] }, or,
  // when the whole pipeline ran in the query layer, like a find.
  const sectionOf = function (explained) {
    if (explained.stages && explained.stages.length > 0) {
      const first = explained.stages[0];
      return first[Object.keys(first)[0]];
    }
    return explained;
  };

  let failures = 0;
  const report = function (label, explained) {
    const section = sectionOf(explained);
    const plan = section && section.queryPlanner && section.queryPlanner.winningPlan;
    const stats = (section && section.executionStats) || {};
    if (!plan) {
      print('????  ' + label + '  (unexpected explain output: ' + JSON.stringify(explained).slice(0, 200) + ')');
      failures += 1;
      return;
    }
    const stages = stagesOf(plan);
    const scansCollection = stages.some(function (stage) {
      return stage.indexOf('COLLSCAN') === 0;
    });
    if (scansCollection) failures += 1;
    print(
      (scansCollection ? 'FAIL  ' : 'PASS  ') + label + '\n' +
        '        plan:     ' + stages.join(' > ') + '\n' +
        '        returned: ' + stats.nReturned + '   keys read: ' + stats.totalKeysExamined +
        '   documents read: ' + stats.totalDocsExamined + '   ' + stats.executionTimeMillis + ' ms',
    );
  };

  print('Tenant "' + tenantId + '", ' + db.restaurants.countDocuments({ tenantId: tenantId }) + ' restaurants.');
  print('');
  finds.forEach(function (shape) {
    report(shape[0], db.restaurants.find(shape[1]).sort(shape[2]).limit(PAGE).explain('executionStats'));
  });
  aggregations.forEach(function (shape) {
    report(shape[0], db.restaurants.explain('executionStats').aggregate(shape[1]));
  });

  print('');
  if (failures === 0) {
    print('Result: PASS (no query scans the whole collection)');
  } else {
    print('Result: FAIL (' + failures + ' of ' + (finds.length + aggregations.length) + ' queries need attention)');
    quit(1);
  }
})();
