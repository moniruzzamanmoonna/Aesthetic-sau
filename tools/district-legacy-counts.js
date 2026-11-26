#!/usr/bin/env node
/*
 * Counts the districts of earlier (no-login) registrations for the District Mates chart.
 * Only numbers are published — these people were told their district is never shown.
 * Skips duplicate submissions (same name + day) and entries linked to a profile (claimed),
 * because those people are counted through their profile instead.
 *
 *   firebase database:get /birthday-mates --project aesthetic-sau -o bm.json
 *   firebase database:get /bday-claims    --project aesthetic-sau -o claims.json
 *   node tools/district-legacy-counts.js bm.json claims.json > legacy.json
 *   firebase database:set /district-legacy legacy.json --project aesthetic-sau
 */
'use strict';
const fs = require('fs');
const C = require('../js/bday-core.js');
const read = function (p) { return p ? (JSON.parse(fs.readFileSync(p, 'utf8') || 'null') || {}) : {}; };
const data = read(process.argv[2]);
const claims = read(process.argv[3]);
const known = {};
C.DISTRICTS.forEach(function (d) { known[C.districtKey(d)] = 1; });

const out = {};
const seen = {};
let counted = 0, unknown = 0;
Object.keys(data).sort().forEach(function (key) {
  const e = data[key];
  if (!e || !e.district || claims[key]) return;
  const dedupe = C.cleanName(e.name).toLowerCase() + '|' + C.mdFromDob(e.birthday);
  if (seen[dedupe]) return;
  seen[dedupe] = 1;
  const dk = C.districtKey(String(e.district).trim());
  if (!known[dk]) { unknown++; return; }
  out[dk] = (out[dk] || 0) + 1;
  counted++;
});
process.stdout.write(JSON.stringify(out) + '\n');
console.error('legacy district counts:', counted, 'people in', Object.keys(out).length, 'districts; unknown names skipped:', unknown);
