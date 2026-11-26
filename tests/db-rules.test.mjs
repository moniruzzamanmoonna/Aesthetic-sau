/*
 * Security-rules tests for the Birthday Mate nodes (and a regression pass over existing nodes).
 * Runs against the Realtime Database emulator — never the live database.
 *
 *   npm i -D @firebase/rules-unit-testing@3 firebase@10      (once, needs Java for the emulator)
 *   node tools/build-db-rules.js
 *   firebase emulators:exec --only database --project demo-bday "node --test tests/db-rules.test.mjs"
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(process.env.RULES_FILE || path.join(here, '..', 'database.rules.json'), 'utf8');
const TS = { '.sv': 'timestamp' };
const LEGACY = '-LegacyKey000000001A';
const ADMIN = { email: 'aestheticsau3100@gmail.com', email_verified: true };

let env;
before(async () => {
  const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
  env = await initializeTestEnvironment({ projectId: 'demo-bday', database: { rules: RULES, host, port: +port } });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref().update({
      ['birthday-mates/' + LEGACY]: { name: 'Old Student', faculty: 'Agriculture', district: 'Sylhet', birthday: '2003-11-26', timestamp: '2025-01-01T00:00:00Z', gmail: 'old@example.com' },
      ['bday-members/11-26/' + LEGACY]: { n: 'Old Student', f: 'Agriculture', t: 'g' },
      ['bday-marks/11-26/' + LEGACY]: true,
      'site-config/followerCount': 1
    });
  });
});

const anon = () => env.unauthenticatedContext().database();
const as = (uid, claims) => env.authenticatedContext(uid, claims || { email: uid + '@example.com', email_verified: true }).database();
const adminDb = () => env.authenticatedContext('admin1', ADMIN).database();

function profileUpdate(uid, p) {
  const md = p.birthday.slice(5);
  const prof = { name: p.name, faculty: p.faculty || 'Agriculture', birthday: p.birthday, md, visibility: p.vis, createdAt: p.createdAt || TS, updatedAt: TS };
  if (p.batch) prof.batch = p.batch;
  const row = { n: prof.name, f: prof.faculty, t: 'u' };
  if (p.batch) row.b = p.batch;
  return {
    ['profiles/' + uid]: prof,
    ['bday-public/' + md + '/u_' + uid]: p.vis === 'public' ? row : null,
    ['bday-members/' + md + '/u_' + uid]: p.vis === 'members' ? row : null,
    ['bday-marks/' + md + '/u_' + uid]: p.vis === 'private' ? null : true
  };
}
async function seedProfiles() {
  await assertSucceeds(as('alice').ref().update(profileUpdate('alice', { name: 'Alice Akter', birthday: '2004-11-26', vis: 'public', batch: '2022' })));
  await assertSucceeds(as('bob').ref().update(profileUpdate('bob', { name: 'Bob Barua', birthday: '1999-11-26', vis: 'members' })));
  await assertSucceeds(as('carol').ref().update(profileUpdate('carol', { name: 'Carol Chowdhury', birthday: '2002-11-26', vis: 'private' })));
}
function wishUpdate(from, to, wid, wish, extra) {
  const u = {
    ['wishes/' + to + '/' + wid]: Object.assign({ at: TS }, wish),
    ['wish-meta/' + wid]: { from, to, at: TS },
    ['wish-rate/' + from]: { last: TS, win: TS, n: 1 },
    ['wish-pair/' + from + '/' + to]: TS
  };
  return Object.assign(u, extra || {});
}

// ── reading / privacy ─────────────────────────────────────────────────
test('visitors see public rows only; full entries and profiles stay private', async () => {
  await seedProfiles();
  await assertSucceeds(anon().ref('bday-public/11-26').get());
  await assertFails(anon().ref('bday-members/11-26').get());
  await assertFails(anon().ref('birthday-mates').get());
  await assertFails(anon().ref('birthday-mates/' + LEGACY).get());
  await assertFails(anon().ref('profiles/alice').get());
  const pub = (await anon().ref('bday-public/11-26').get()).val();
  assert.deepEqual(Object.keys(pub), ['u_alice']);
  assert.deepEqual(Object.keys(pub.u_alice).sort(), ['b', 'f', 'n', 't'], 'no email / year / uid fields in public rows');
});

test('members see members-only rows; private users appear nowhere', async () => {
  await seedProfiles();
  await assertSucceeds(as('dave').ref().update(profileUpdate('dave', { name: 'Dave Das', birthday: '2001-03-03', vis: 'members' })));
  const db = as('dave');
  const mem = (await assertSucceeds(db.ref('bday-members/11-26').get())).val();
  const pub = (await db.ref('bday-public/11-26').get()).val();
  const keys = Object.keys(mem).concat(Object.keys(pub));
  assert.ok(keys.includes('u_bob') && keys.includes('u_alice') && keys.includes(LEGACY));
  assert.ok(!keys.includes('u_carol'), 'private profile not in any index');
  await assertFails(db.ref('profiles/bob').get());
  await assertFails(db.ref('profiles').get());
  await assertFails(db.ref('birthday-mates').get());
  await assertSucceeds(as('bob').ref('profiles/bob').get());
});

test('month query (orderByKey range) works for both index nodes', async () => {
  await seedProfiles();
  await assertSucceeds(anon().ref('bday-public').orderByKey().startAt('11-01').endAt('11-31').get());
  await assertFails(anon().ref('bday-members').orderByKey().startAt('11-01').endAt('11-31').get());
  await assertFails(as('dave').ref('bday-members').orderByKey().startAt('11-01').endAt('11-31').get(), 'signed in but no profile');
  await assertSucceeds(as('dave').ref().update(profileUpdate('dave', { name: 'Dave Das', birthday: '2001-03-03', vis: 'public' })));
  await assertSucceeds(as('dave').ref('bday-members').orderByKey().startAt('11-01').endAt('11-31').get());
});

test('give-to-get: private users and users without a profile cannot see members-only birthdays', async () => {
  await seedProfiles();
  // no profile
  await assertFails(as('nobody').ref('bday-members/11-26').get());
  await assertFails(as('nobody').ref('bday-members').get());
  // carol is private (born 26 Nov): no month/other-day access ...
  await assertFails(as('carol').ref('bday-members').orderByKey().startAt('11-01').endAt('11-31').get());
  await assertFails(as('carol').ref('bday-members/11-12').get());
  // ... but she may read her own day, for the "is one of these you?" check
  await assertSucceeds(as('carol').ref('bday-members/11-26').get());
  // sharing users (public or members) can read
  await assertSucceeds(as('alice').ref('bday-members/11-12').get());
  await assertSucceeds(as('bob').ref('bday-members').orderByKey().startAt('11-01').endAt('11-31').get());
  // public rows stay public for everyone
  await assertSucceeds(as('carol').ref('bday-public/11-26').get());
});

test('count markers: readable by everyone, no names, always in step with rows', async () => {
  await seedProfiles();
  const marks = (await assertSucceeds(anon().ref('bday-marks/11-26').get())).val();
  assert.deepEqual(Object.keys(marks).sort(), [LEGACY, 'u_alice', 'u_bob'].sort(), 'public + members rows counted, private carol not');
  assert.ok(Object.values(marks).every((v) => v === true), 'markers carry no names');
  await assertSucceeds(anon().ref('bday-marks').orderByKey().startAt('11-01').endAt('11-31').get());
  await assertFails(anon().ref('bday-marks/11-26/u_fake').set(true), 'no phantom markers');
  await assertFails(as('mallory').ref('bday-marks/11-26/u_bob').remove(), 'cannot hide someone');
  await assertFails(anon().ref('bday-marks/11-26/x').set('Name'), 'value must be true');
  // a visibility change that forgets the marker is rejected
  const createdAt = (await as('bob').ref('profiles/bob/createdAt').get()).val();
  const toPrivate = profileUpdate('bob', { name: 'Bob Barua', birthday: '1999-11-26', vis: 'private', createdAt });
  await assertFails(as('bob').ref().update(Object.assign({}, toPrivate, { 'bday-marks/11-26/u_bob': true })));
  await assertSucceeds(as('bob').ref().update(toPrivate));
  assert.equal((await anon().ref('bday-marks/11-26/u_bob').get()).exists(), false);
});

test('wishes are give-to-get too', async () => {
  await seedProfiles();
  // carol is private: may wish public alice, not members-only bob
  await assertFails(as('carol').ref().update(wishUpdate('carol', 'bob', 'g1', { msg: 'hi', anon: true })));
  await assertSucceeds(as('carol').ref().update(wishUpdate('carol', 'alice', 'g2', { msg: 'hi', anon: true })));
  // no profile at all: only public recipients
  await assertFails(as('ghost').ref().update(wishUpdate('ghost', 'bob', 'g3', { msg: 'hi', anon: true })));
  await assertSucceeds(as('ghost').ref().update(wishUpdate('ghost', 'alice', 'g4', { msg: 'hi', anon: true })));
});

// ── District Mates ────────────────────────────────────────────────────
const INC = (n) => ({ '.sv': { increment: n } });
function withDistrict(uid, p, district, extra) {
  const u = profileUpdate(uid, p);
  const dk = district.toLowerCase().split(' ').join('-').split("'").join('-');
  u['profiles/' + uid].district = district;
  const row = { n: p.name, f: p.faculty || 'Agriculture' };
  u['district-public/' + dk + '/u_' + uid] = p.vis === 'public' ? row : null;
  u['district-members/' + dk + '/u_' + uid] = p.vis === 'members' ? row : null;
  return Object.assign(u, extra || {});
}

test('district rows and counts follow the profile', async () => {
  // join Sylhet as members-only -> count +1, members row
  await assertFails(as('d1').ref().update(withDistrict('d1', { name: 'Dina', birthday: '2003-01-01', vis: 'members' }, 'Sylhet')), 'count must move');
  await assertFails(as('d1').ref().update(withDistrict('d1', { name: 'Dina', birthday: '2003-01-01', vis: 'members' }, 'Sylhet', { 'district-counts/sylhet': INC(2) })), 'only by one');
  await assertFails(as('d1').ref().update(withDistrict('d1', { name: 'Dina', birthday: '2003-01-01', vis: 'members' }, 'Atlantis', { 'district-counts/atlantis': INC(1) })), 'unknown district');
  await assertSucceeds(as('d1').ref().update(withDistrict('d1', { name: 'Dina', birthday: '2003-01-01', vis: 'members' }, 'Sylhet', { 'district-counts/sylhet': INC(1) })));
  // apostrophe + space districts map like the client: "Cox's Bazar" -> cox-s-bazar
  await assertSucceeds(as('d2').ref().update(withDistrict('d2', { name: 'Kabir', birthday: '2002-02-02', vis: 'public' }, "Cox's Bazar", { 'district-counts/cox-s-bazar': INC(1) })));
  await assertSucceeds(as('d4').ref().update(withDistrict('d4', { name: 'Nabil', birthday: '2002-02-03', vis: 'members' }, 'Chapai Nawabganj', { 'district-counts/chapai-nawabganj': INC(1) })));
  assert.equal((await anon().ref('district-counts/sylhet').get()).val(), 1);
  assert.equal((await anon().ref('district-counts/cox-s-bazar').get()).val(), 1);
  // private with a district: not counted, no rows
  await assertSucceeds(as('d3').ref().update(withDistrict('d3', { name: 'Priya', birthday: '2001-03-03', vis: 'private' }, 'Sylhet')));
  assert.equal((await anon().ref('district-counts/sylhet').get()).val(), 1);

  // reading: counts + public rows for everyone, members rows only for people who share
  await assertSucceeds(anon().ref('district-public/cox-s-bazar').get());
  await assertFails(anon().ref('district-members/sylhet').get());
  await assertFails(as('d3').ref('district-members/sylhet').get(), 'private user');
  await assertSucceeds(as('d2').ref('district-members/sylhet').get());

  // tampering
  await assertFails(anon().ref('district-counts/sylhet').set(50));
  await assertFails(as('d2').ref('district-counts/dhaka').set(INC(1)), 'no +1 without joining');
  await assertFails(as('d2').ref('district-public/dhaka/u_d2').set({ n: 'Kabir', f: 'Agriculture' }), 'row must match profile district');
  await assertFails(anon().ref('district-legacy/dhaka').set(5));
  await assertSucceeds(adminDb().ref('district-legacy/dhaka').set(5));

  // move Sylhet -> Dhaka: old row gone, -1 / +1
  const createdAt = (await as('d1').ref('profiles/d1/createdAt').get()).val();
  const move = withDistrict('d1', { name: 'Dina', birthday: '2003-01-01', vis: 'members', createdAt }, 'Dhaka', { 'district-members/sylhet/u_d1': null, 'district-counts/dhaka': INC(1) });
  await assertFails(as('d1').ref().update(move), 'missing the decrement');
  await assertSucceeds(as('d1').ref().update(Object.assign({}, move, { 'district-counts/sylhet': INC(-1) })));
  assert.equal((await anon().ref('district-counts/sylhet').get()).val(), 0);
  assert.equal((await anon().ref('district-counts/dhaka').get()).val(), 1);

  // go private: -1 and rows removed
  const priv = withDistrict('d1', { name: 'Dina', birthday: '2003-01-01', vis: 'private', createdAt }, 'Dhaka');
  await assertFails(as('d1').ref().update(priv), 'private must leave the count');
  await assertSucceeds(as('d1').ref().update(Object.assign({}, priv, { 'district-counts/dhaka': INC(-1) })));

  // delete profile: rows + count must go too
  const del = { 'profiles/d2': null, 'bday-public/02-02/u_d2': null, 'bday-marks/02-02/u_d2': null };
  await assertFails(as('d2').ref().update(del));
  await assertSucceeds(as('d2').ref().update(Object.assign({}, del, { 'district-public/cox-s-bazar/u_d2': null, 'district-counts/cox-s-bazar': INC(-1) })));
  assert.equal((await anon().ref('district-counts/cox-s-bazar').get()).val(), 0);
});

// ── profiles ──────────────────────────────────────────────────────────
test('profile + index must agree', async () => {
  const u = profileUpdate('eve', { name: 'Eve', birthday: '2001-05-05', vis: 'public' });
  // missing index row
  await assertFails(as('eve').ref().update({ ['profiles/eve']: u['profiles/eve'] }));
  // row in the wrong visibility node
  await assertFails(as('eve').ref().update({ ['profiles/eve']: u['profiles/eve'], 'bday-members/05-05/u_eve': { n: 'Eve', f: 'Agriculture', t: 'u' } }));
  // name mismatch
  await assertFails(as('eve').ref().update({ ['profiles/eve']: u['profiles/eve'], 'bday-public/05-05/u_eve': { n: 'Someone Else', f: 'Agriculture', t: 'u' } }));
  // md that doesn't match the birthday
  await assertFails(as('eve').ref().update({ ['profiles/eve']: Object.assign({}, u['profiles/eve'], { md: '05-06' }), 'bday-public/05-06/u_eve': { n: 'Eve', f: 'Agriculture', t: 'u' } }));
  // invalid date
  await assertFails(as('eve').ref().update(profileUpdate('eve', { name: 'Eve', birthday: '2001-02-30', vis: 'members' })));
  await assertSucceeds(as('eve').ref().update(u));
});

test('cannot write other people\'s profile or index rows; birthday is immutable', async () => {
  await seedProfiles();
  await assertFails(as('mallory').ref().update(profileUpdate('alice', { name: 'Hacked', birthday: '2004-11-26', vis: 'public' })));
  await assertFails(as('mallory').ref('bday-public/11-26/u_alice').remove());
  await assertFails(as('mallory').ref('bday-public/11-26/u_mallory').set({ n: 'Fake', f: 'X', t: 'u' }), 'index row without profile');
  // alice changes her birthday -> rejected
  const createdAt = (await as('alice').ref('profiles/alice/createdAt').get()).val();
  const moved = profileUpdate('alice', { name: 'Alice Akter', birthday: '2004-11-27', vis: 'public', batch: '2022', createdAt });
  moved['bday-public/11-26/u_alice'] = null;
  await assertFails(as('alice').ref().update(moved));
});

test('switching visibility moves the row atomically; private removes it', async () => {
  await seedProfiles();
  const createdAt = (await as('alice').ref('profiles/alice/createdAt').get()).val();
  await assertFails(as('alice').ref().update(profileUpdate('alice', { name: 'Alice Akter', birthday: '2004-11-26', vis: 'private', batch: '2022' })), 'createdAt cannot be reset');
  const toPrivate = profileUpdate('alice', { name: 'Alice Akter', birthday: '2004-11-26', vis: 'private', batch: '2022', createdAt });
  await assertSucceeds(as('alice').ref().update(toPrivate));
  assert.equal((await anon().ref('bday-public/11-26/u_alice').get()).exists(), false);
  // a private user cannot sneak a public row back in
  await assertFails(as('alice').ref('bday-public/11-26/u_alice').set({ n: 'Alice Akter', f: 'Agriculture', b: '2022', t: 'u' }));
  const toMembers = profileUpdate('alice', { name: 'Alice Akter', birthday: '2004-11-26', vis: 'members', batch: '2022', createdAt });
  await assertSucceeds(as('alice').ref().update(toMembers));
});

test('deleting a profile requires removing its index row in the same write', async () => {
  await seedProfiles();
  await assertFails(as('bob').ref('profiles/bob').remove());
  await assertSucceeds(as('bob').ref().update({ 'profiles/bob': null, 'bday-members/11-26/u_bob': null, 'bday-marks/11-26/u_bob': null }));
});

// ── guest (no-login) entries ──────────────────────────────────────────
test('guest registration: create-only, members-only, consistent', async () => {
  const k = '-NewGuestKey00000001';
  const entry = { name: 'Guest One', faculty: 'Fisheries', district: 'Dhaka', birthday: '2005-03-14', timestamp: '2026-11-26T10:00:00Z', claim: 'T'.repeat(32) };
  await assertFails(anon().ref().update({ ['birthday-mates/' + k]: entry, ['bday-public/03-14/' + k]: { n: 'Guest One', f: 'Fisheries', t: 'g' } }), 'guests never public');
  await assertFails(anon().ref().update({ ['birthday-mates/' + k]: entry, ['bday-members/03-15/' + k]: { n: 'Guest One', f: 'Fisheries', t: 'g' } }), 'wrong day');
  await assertFails(anon().ref().update({ ['birthday-mates/' + k]: entry, ['bday-members/03-14/' + k]: { n: 'Other Name', f: 'Fisheries', t: 'g' } }), 'name mismatch');
  await assertFails(anon().ref().update({ ['birthday-mates/u_x']: entry }), 'bad key');
  await assertFails(anon().ref().update({ ['birthday-mates/' + k]: Object.assign({}, entry, { birthday: '2005-02-30' }) }), 'bad date');
  await assertFails(anon().ref().update({ ['birthday-mates/' + k]: entry, ['bday-members/03-14/' + k]: { n: 'Guest One', f: 'Fisheries', t: 'g' } }), 'row without its count marker');
  await assertSucceeds(anon().ref().update({ ['birthday-mates/' + k]: entry, ['bday-members/03-14/' + k]: { n: 'Guest One', f: 'Fisheries', t: 'g' }, ['bday-marks/03-14/' + k]: true }));
  await assertFails(anon().ref('birthday-mates/' + k).update({ name: 'Changed' }), 'no overwrite');
  await assertFails(anon().ref('birthday-mates/' + LEGACY).remove(), 'no delete');
  await assertFails(anon().ref('bday-members/11-26/' + LEGACY).remove());
});

test('claiming a guest entry: name+birthday match (legacy) or token (new)', async () => {
  await seedProfiles();
  // same day + month but a different year -> cannot claim the legacy row
  await assertSucceeds(as('dave').ref().update(profileUpdate('dave', { name: 'Dave Das', birthday: '2004-11-26', vis: 'members' })));
  await assertFails(as('dave').ref().update({ ['bday-claims/' + LEGACY]: { uid: 'dave', at: TS }, ['bday-members/11-26/' + LEGACY]: null }));
  // no profile yet -> cannot claim
  await assertFails(as('noprof').ref().update({ ['bday-claims/' + LEGACY]: { uid: 'noprof', at: TS } }));
  // "this is me": full date of birth matches (name may differ, e.g. Google display name)
  await assertSucceeds(as('olds').ref().update(profileUpdate('olds', { name: 'Different Display Name', birthday: '2003-11-26', vis: 'private' })));
  await assertFails(as('olds').ref().update({ ['bday-claims/' + LEGACY]: { uid: 'someone-else', at: TS }, ['bday-members/11-26/' + LEGACY]: null }));
  await assertSucceeds(as('olds').ref().update({ ['bday-claims/' + LEGACY]: { uid: 'olds', at: TS }, ['bday-members/11-26/' + LEGACY]: null, ['bday-marks/11-26/' + LEGACY]: null }));
  assert.equal((await as('dave').ref('bday-members/11-26/' + LEGACY).get()).exists(), false, 'private now applies to the old row too');
  await assertFails(anon().ref().update({ ['bday-members/11-26/' + LEGACY]: { n: 'Old Student', f: 'Agriculture', t: 'g' } }), 'claimed rows cannot be re-created');

  // token claim for a new guest entry
  const k = '-NewGuestKey00000002';
  const tok = 'A'.repeat(32);
  await assertSucceeds(anon().ref().update({
    ['birthday-mates/' + k]: { name: 'Token Person', faculty: 'Fisheries', birthday: '2001-01-02', timestamp: 'x', claim: tok },
    ['bday-members/01-02/' + k]: { n: 'Token Person', f: 'Fisheries', t: 'g' },
    ['bday-marks/01-02/' + k]: true
  }));
  await assertSucceeds(as('tp').ref().update(profileUpdate('tp', { name: 'Different Display Name', birthday: '2001-01-02', vis: 'members' })));
  await assertFails(as('tp').ref().update({ ['bday-claims/' + k]: { uid: 'tp', token: 'B'.repeat(32), at: TS } }), 'wrong token');
  await assertSucceeds(as('tp').ref().update({ ['bday-claims/' + k]: { uid: 'tp', token: tok, at: TS }, ['bday-members/01-02/' + k]: null, ['bday-marks/01-02/' + k]: null }));
  await assertFails(as('tp').ref('bday-claims').get(), 'claims are admin-only');
});

// ── anonymous wishes ──────────────────────────────────────────────────
test('anonymous wish: delivered without sender identity', async () => {
  await seedProfiles();
  await assertSucceeds(as('alice').ref().update(wishUpdate('alice', 'bob', 'w1', { msg: 'Happy Birthday! 🌻', anon: true })));
  const got = (await assertSucceeds(as('bob').ref('wishes/bob').get())).val();
  assert.deepEqual(Object.keys(got.w1).sort(), ['anon', 'at', 'msg'], 'no sender fields reach the recipient');
  await assertFails(as('bob').ref('wish-meta/w1').get(), 'recipient cannot see who sent it');
  await assertFails(as('bob').ref('wish-meta').get());
  await assertFails(as('bob').ref('wish-pair/alice').get());
  await assertFails(as('bob').ref('wish-rate/alice').get());
  await assertFails(as('alice').ref('wishes/bob').get(), 'sender cannot read recipient inbox');
  await assertFails(anon().ref('wishes/bob').get());
  const meta = (await assertSucceeds(adminDb().ref('wish-meta/w1').get())).val();
  assert.equal(meta.from, 'alice', 'admin can identify the sender');
});

test('wish validation: empty, too long, links, spoofing', async () => {
  await seedProfiles();
  const db = as('alice');
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'e1', { msg: '', anon: true })));
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'e2', { msg: '    ', anon: true })));
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'e3', { msg: 'x'.repeat(301), anon: true })));
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'e4', { msg: 'see https://x.y', anon: true })));
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'e5', { msg: 'hi', anon: true, fromName: 'Alice Akter' })), 'anonymous must not carry a name');
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'e6', { msg: 'hi', anon: false, fromName: 'Carol Chowdhury' })), 'cannot impersonate');
  await assertFails(db.ref().update(Object.assign(wishUpdate('alice', 'bob', 'e7', { msg: 'hi', anon: true }), { 'wish-meta/e7': { from: 'bob', to: 'bob', at: TS } })), 'cannot spoof meta');
  await assertFails(db.ref('wishes/bob/e8').set({ msg: 'hi', anon: true, at: TS }), 'wish without meta + rate rows');
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'e9', { msg: 'hi', anon: true, extra: 1 })), 'unknown fields');
  await assertFails(db.ref().update(wishUpdate('alice', 'alice', 'e10', { msg: 'hi', anon: true })), 'not to self');
  await assertFails(db.ref().update(wishUpdate('alice', 'carol', 'e11', { msg: 'hi', anon: true })), 'not to private users');
  await assertFails(db.ref().update(wishUpdate('alice', 'nobody', 'e12', { msg: 'hi', anon: true })), 'not to users without profile');
  await assertFails(anon().ref().update(wishUpdate('alice', 'bob', 'e13', { msg: 'hi', anon: true })), 'must be signed in');
  await assertSucceeds(db.ref().update(wishUpdate('alice', 'bob', 'ok1', { msg: 'x'.repeat(300), anon: false, fromName: 'Alice Akter' })), '300 chars + real name ok');
});

test('rate limits: 30 s gap, one per recipient per 20 h, 10 per day, no resets', async () => {
  await seedProfiles();
  const db = as('alice');
  await assertSucceeds(db.ref().update(wishUpdate('alice', 'bob', 'r1', { msg: 'one', anon: true })));
  // immediately again (rate row would need n:2 and the 30 s gap)
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'r2', { msg: 'two', anon: true }, { 'wish-rate/alice': { last: TS, win: TS, n: 1 } })));
  await assertFails(db.ref('wish-rate/alice').remove(), 'cannot reset the rate counter');
  await assertFails(db.ref('wish-pair/alice/bob').remove(), 'cannot reset the pair limit');

  const now = Date.now();
  // 40 s later, same recipient -> pair limit
  await env.withSecurityRulesDisabled((ctx) => ctx.database().ref('wish-rate/alice').set({ last: now - 40000, win: now - 40000, n: 1 }));
  const win = (await db.ref('wish-rate/alice/win').get()).val();
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'r3', { msg: 'again', anon: true }, { 'wish-rate/alice': { last: TS, win, n: 2 } })), 'same person within 20 h');
  // a different recipient is fine
  await assertSucceeds(as('zed').ref().update(profileUpdate('zed', { name: 'Zed Zaman', birthday: '2000-01-01', vis: 'members' })));
  await assertSucceeds(db.ref().update(wishUpdate('alice', 'zed', 'r4', { msg: 'hi zed', anon: true }, { 'wish-rate/alice': { last: TS, win, n: 2 } })));

  // daily cap
  await env.withSecurityRulesDisabled((ctx) => ctx.database().ref().update({ 'wish-rate/alice': { last: now - 60000, win: now - 3600000, n: 10 }, 'wish-pair/alice': null }));
  await assertFails(db.ref().update(wishUpdate('alice', 'bob', 'r5', { msg: 'eleventh', anon: true }, { 'wish-rate/alice': { last: TS, win: now - 3600000, n: 11 } })));
  // fresh window after 24 h
  await env.withSecurityRulesDisabled((ctx) => ctx.database().ref('wish-rate/alice').set({ last: now - 60000, win: now - 90000000, n: 10 }));
  await assertSucceeds(db.ref().update(wishUpdate('alice', 'bob', 'r6', { msg: 'new day', anon: true })));
});

test('recipient can report or delete, but not edit; others cannot touch it', async () => {
  await seedProfiles();
  await assertSucceeds(as('alice').ref().update(wishUpdate('alice', 'bob', 'w1', { msg: 'mean words', anon: true })));
  await assertFails(as('bob').ref('wishes/bob/w1/msg').set('edited'));
  await assertFails(as('alice').ref('wishes/bob/w1/reported').set(true));
  await assertFails(as('alice').ref('wishes/bob/w1').remove());
  await assertSucceeds(as('bob').ref('wishes/bob/w1').update({ reported: true, reportedAt: TS }));
  await assertSucceeds(as('bob').ref('wishes/bob/w1').remove());
  assert.ok((await adminDb().ref('wish-meta/w1').get()).exists(), 'moderation record survives recipient deletion');
});

// ── admin ─────────────────────────────────────────────────────────────
test('admin access requires a verified admin Google account', async () => {
  await seedProfiles();
  await assertSucceeds(adminDb().ref('admin-check').get());
  await assertSucceeds(adminDb().ref('birthday-mates').get());
  await assertSucceeds(adminDb().ref('profiles').get());
  await assertSucceeds(adminDb().ref('wishes').get());
  await assertFails(env.authenticatedContext('x', { email: ADMIN.email, email_verified: false }).database().ref('admin-check').get(), 'unverified email');
  await assertFails(as('alice').ref('admin-check').get());
  await assertFails(anon().ref('admin-check').get());
  // admin moderation actions
  await assertSucceeds(as('alice').ref().update(wishUpdate('alice', 'bob', 'w9', { msg: 'bad', anon: true })));
  await assertSucceeds(adminDb().ref().update({ 'wishes/bob/w9': null, 'wish-meta/w9/removedAt': TS }));
  await assertSucceeds(adminDb().ref().update({ ['birthday-mates/' + LEGACY + '/name']: 'Old Student Edited', ['bday-members/11-26/' + LEGACY]: { n: 'Old Student Edited', f: 'Agriculture', t: 'g' } }));
  await assertSucceeds(adminDb().ref().update({ ['birthday-mates/' + LEGACY]: null, ['bday-members/11-26/' + LEGACY]: null, ['bday-marks/11-26/' + LEGACY]: null }));
});

// ── regression: nodes that existed before Birthday Mate ────────────────
test('existing site nodes keep their previous behaviour', async () => {
  await assertSucceeds(anon().ref('site-config').get());
  await assertSucceeds(anon().ref('site-config/followerCount').set(2));
  await assertSucceeds(anon().ref('photo-votes/abc').set(1));
  await assertSucceeds(anon().ref('pre-orders').push({ name: 'x' }));
  await assertSucceeds(anon().ref('presence/s1').set({ t: 1 }));
  await assertSucceeds(anon().ref('daily-visits/20261126').set(5));
  await assertSucceeds(anon().ref('game-rooms/r1').set({ a: 1 }));
  await assertSucceeds(anon().ref('sau-ratings/items/halim/likes').set(1));
  await assertFails(anon().ref('random-node').set(1));
  await assertFails(anon().ref().get());
});
