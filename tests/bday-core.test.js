// node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/bday-core.js');

test('parseDob / validateDob', () => {
  assert.deepEqual(C.parseDob('2005-06-03'), { y: 2005, m: 6, d: 3 });
  assert.equal(C.parseDob('2005-02-29'), null, '2005 is not a leap year');
  assert.deepEqual(C.parseDob('2004-02-29'), { y: 2004, m: 2, d: 29 });
  assert.equal(C.parseDob('2001-04-31'), null);
  assert.equal(C.parseDob('26/09/2003'), null);
  const today = new Date(2026, 10, 26);
  assert.equal(C.validateDob('2003-09-26', today), '');
  assert.match(C.validateDob('2027-01-01', today), /future/);
  assert.match(C.validateDob('1900-01-01', today), /year/);
  assert.match(C.validateDob('', today), /valid/);
});

test('month-day keys ignore the year', () => {
  assert.equal(C.mdFromDob('2003-09-26'), '09-26');
  assert.equal(C.mdFromDob('1999-09-26'), C.mdFromDob('2005-09-26'), 'same date, different year -> same key');
  assert.notEqual(C.mdFromDob('2003-09-26'), C.mdFromDob('2003-09-27'));
  assert.equal(C.mdFromDate(new Date(2026, 10, 26)), '11-26');
  assert.equal(C.formatMd('11-26'), '26 November');
});

test('celebrationKeys handles 29 February', () => {
  assert.deepEqual(C.celebrationKeys(new Date(2026, 10, 26)), ['11-26']);
  assert.deepEqual(C.celebrationKeys(new Date(2027, 1, 28)), ['02-28', '02-29'], 'common year: leap-day babies on 28 Feb');
  assert.deepEqual(C.celebrationKeys(new Date(2028, 1, 28)), ['02-28'], 'leap year: 28 Feb only');
  assert.deepEqual(C.celebrationKeys(new Date(2028, 1, 29)), ['02-29']);
  assert.equal(C.isLeap(2000), true);
  assert.equal(C.isLeap(1900), false);
});

test('monthGrid: shape, today, leap handling', () => {
  const today = new Date(2026, 10, 26);
  const nov = C.monthGrid(2026, 11, today);
  const cells = nov.flat().filter(Boolean);
  assert.equal(cells.length, 30);
  assert.ok(nov.every((w) => w.length === 7));
  assert.equal(nov[0].findIndex(Boolean), new Date(2026, 10, 1).getDay(), '1 Nov 2026 is a Sunday');
  assert.deepEqual(cells.filter((c) => c.isToday).map((c) => c.day), [26]);
  const feb27 = C.monthGrid(2027, 2).flat().filter(Boolean);
  assert.equal(feb27.length, 28);
  assert.deepEqual(feb27[27].keys, ['02-28', '02-29']);
  const feb28 = C.monthGrid(2028, 2).flat().filter(Boolean);
  assert.equal(feb28.length, 29);
  assert.deepEqual(feb28[27].keys, ['02-28']);
  assert.deepEqual(feb28[28].keys, ['02-29']);
});

test('shiftMonth wraps years', () => {
  assert.deepEqual(C.shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(C.shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(C.shiftMonth(2026, 11, 0), { year: 2026, month: 11 });
});

test('mergeEntries: twins, dedupe, exclusions, private never present', () => {
  const pub = { md: '09-26', vis: 'public', rows: { u_a: { n: 'Rahim', f: 'Agriculture', t: 'u' } } };
  const mem = {
    md: '09-26', vis: 'members', rows: {
      '-guest1': { n: 'Karim', f: 'Fisheries', t: 'g' },
      '-guest2': { n: 'rahim', f: 'Agriculture', t: 'g' }, // same person's old guest row
      u_me: { n: 'Me', f: 'Fisheries', t: 'u' },
      bad: null
    }
  };
  const out = C.mergeEntries([pub, mem], ['u_me']);
  assert.deepEqual(out.map((x) => x.name).sort(), ['Karim', 'Rahim']);
  const rahim = out.find((x) => x.name === 'Rahim');
  assert.equal(rahim.uid, 'a', 'account row wins over duplicate guest row');
  assert.equal(rahim.uid, 'a');
  const karim = out.find((x) => x.name === 'Karim');
  assert.equal(karim.canWish, true, 'no-account entries get held wishes');
  assert.equal(karim.to, 'g:-guest1');
  assert.equal(rahim.to, 'a');
  assert.deepEqual(C.mergeEntries([], []), []);
  // output never carries anything beyond the public projection
  out.forEach((x) => assert.deepEqual(Object.keys(x).sort(), ['anonbox', 'batch', 'canWish', 'faculty', 'key', 'md', 'name', 'photo', 'to', 'uid', 'visibility']));
});

test('checkWish validation', () => {
  assert.equal(C.checkWish('   ').error.length > 0, true, 'empty rejected');
  assert.equal(C.checkWish('').error.length > 0, true);
  assert.equal(C.checkWish('x'.repeat(301)).error.length > 0, true, 'too long rejected');
  assert.equal(C.checkWish('a'.repeat(300).replace(/a{10}/g, 'abcdefghij')).error, '', 'exactly 300 ok');
  assert.match(C.checkWish('visit https://spam.example').error, /Links/);
  assert.match(C.checkWish('www.spam.com').error, /Links/);
  assert.match(C.checkWish('!!!!!!!!!!!!!!!!').error, /spam/);
  const ok = C.checkWish('  Happy Birthday!   Hope this year brings you lots of happiness. 🌻  ');
  assert.equal(ok.error, '');
  assert.equal(ok.text, 'Happy Birthday! Hope this year brings you lots of happiness. 🌻');
});

test('parseAnonBox accepts usernames and pasted links', () => {
  assert.equal(C.parseAnonBox(''), '');
  assert.equal(C.parseAnonBox('  '), '');
  assert.equal(C.parseAnonBox('MoonStar'), 'moonstar');
  assert.equal(C.parseAnonBox('@moon_star1'), 'moon_star1');
  assert.equal(C.parseAnonBox('https://anon-box2026.web.app/u/moonstar'), 'moonstar');
  assert.equal(C.parseAnonBox('anon-box2026.web.app/u/moonstar?ref=x'), 'moonstar');
  assert.equal(C.parseAnonBox('ab'), null, 'too short');
  assert.equal(C.parseAnonBox('bad name!'), null);
  assert.equal(C.parseAnonBox('javascript:alert(1)'), null);
  assert.equal(C.parseAnonBox('x'.repeat(21)), null);
});

test('pushId format matches the guest-key rule', () => {
  for (let i = 0; i < 50; i++) assert.match(C.pushId(), /^-[A-Za-z0-9_-]{19}$/);
  assert.ok(C.pushId(1000) < C.pushId(2000), 'time ordered');
  assert.equal(C.randomToken(32).length, 32);
});
