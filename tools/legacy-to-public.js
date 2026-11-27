#!/usr/bin/env node
/*
 * 27 Nov 2026: Birthday Mate opened up to visitors without sign-in. Entries registered BEFORE the
 * Phase 1 upgrade (no claim token; the old site already showed them publicly) move from
 * members-only to public — still only name + faculty + day/month. Guests who registered after the
 * upgrade (they have a claim token and were promised "members only") and profiles keep their choice.
 *
 *   firebase database:get /birthday-mates --project aesthetic-sau -o bm.json
 *   firebase database:get /bday-members   --project aesthetic-sau -o mem.json
 *   node tools/legacy-to-public.js bm.json mem.json > move.json
 *   firebase database:update / move.json --project aesthetic-sau
 * Prints counts only.
 */
'use strict';
const fs = require('fs');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8') || 'null') || {};
const bm = read(process.argv[2]);
const mem = read(process.argv[3]);
const out = {};
let moved = 0, kept = 0;
Object.keys(mem).forEach(function (md) {
  Object.keys(mem[md] || {}).forEach(function (key) {
    const row = mem[md][key];
    const entry = bm[key];
    if (!row || row.t !== 'g' || !entry || entry.claim) { kept++; return; }
    out['bday-public/' + md + '/' + key] = row;
    out['bday-members/' + md + '/' + key] = null;
    moved++;
  });
});
process.stdout.write(JSON.stringify(out) + '\n');
console.error('legacy rows moved to public:', moved, '| kept members-only:', kept);
