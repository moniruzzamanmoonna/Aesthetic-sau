#!/usr/bin/env node
/*
 * One-time migration for Birthday Mate Phase 1.
 *
 * Existing birthday-mates entries were never given a visibility choice, so they become
 * "SAU Members Only" and expose only name + faculty + day/month (never year, district or email).
 *
 *   firebase database:get /birthday-mates --project aesthetic-sau -o bm.json
 *   node tools/migrate-legacy-index.js bm.json > bday-index-update.json
 *   firebase database:update / bday-index-update.json --project aesthetic-sau
 *
 * Prints only counts (no personal data) to stderr. Safe to re-run: it only writes
 * bday-members/<MM-DD>/<key> rows, and skips entries already claimed by a signed-in profile
 * (pass the claims export as a second argument if any exist).
 */
'use strict';
const fs = require('fs');
const C = require('../js/bday-core.js');

const src = process.argv[2];
if (!src) { console.error('usage: node tools/migrate-legacy-index.js <birthday-mates.json> [bday-claims.json]'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(src, 'utf8')) || {};
const claims = process.argv[3] ? (JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) || {}) : {};

const out = {};
const seen = {};
const stats = { total: 0, indexed: 0, invalidDate: 0, noName: 0, duplicate: 0, claimed: 0 };
Object.keys(data)
  .sort(function (a, b) { return String((data[a] || {}).timestamp || '') < String((data[b] || {}).timestamp || '') ? -1 : 1; })
  .forEach(function (key) {
    stats.total++;
    const e = data[key];
    if (!e || typeof e !== 'object') { stats.noName++; return; }
    if (claims[key]) { stats.claimed++; return; }
    const name = C.cleanName(e.name);
    if (name.length < 1) { stats.noName++; return; }
    const md = C.mdFromDob(e.birthday);
    if (!md) { stats.invalidDate++; return; }
    const dedupe = name.toLowerCase() + '|' + md;
    if (seen[dedupe]) { stats.duplicate++; return; }
    seen[dedupe] = 1;
    out['bday-members/' + md + '/' + key] = {
      n: name,
      f: String(e.faculty || 'SAU').slice(0, 80) || 'SAU',
      t: 'g'
    };
    stats.indexed++;
  });

process.stdout.write(JSON.stringify(out, null, 1) + '\n');
console.error('migration summary:', JSON.stringify(stats));
