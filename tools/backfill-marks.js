#!/usr/bin/env node
/*
 * Rebuilds bday-marks (the name-free "someone has a birthday on this day" markers that let
 * signed-out visitors see 🎂 counts) from the visible index rows.
 *
 *   firebase database:get /bday-public  --project aesthetic-sau -o pub.json
 *   firebase database:get /bday-members --project aesthetic-sau -o mem.json
 *   node tools/backfill-marks.js pub.json mem.json > marks.json
 *   firebase database:set /bday-marks marks.json --project aesthetic-sau
 */
'use strict';
const fs = require('fs');
const read = function (p) { return p ? (JSON.parse(fs.readFileSync(p, 'utf8') || 'null') || {}) : {}; };
const marks = {};
let n = 0;
[read(process.argv[2]), read(process.argv[3])].forEach(function (node) {
  Object.keys(node).forEach(function (md) {
    Object.keys(node[md] || {}).forEach(function (key) {
      if (!(marks[md] && marks[md][key])) n++;
      (marks[md] = marks[md] || {})[key] = true;
    });
  });
});
process.stdout.write(JSON.stringify(marks) + '\n');
console.error('markers:', n, 'days:', Object.keys(marks).length);
