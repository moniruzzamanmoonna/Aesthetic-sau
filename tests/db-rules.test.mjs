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
    ['bday-members/' + md + '/u_' + uid]: p.vis === 'members' ? row : null
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
  await assertSucceeds(as('dave').ref('bday-members').orderByKey().startAt('11-01').endAt('11-31').get());
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
  await assertSucceeds(as('bob').ref().update({ 'profiles/bob': null, 'bday-members/11-26/u_bob': null }));
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
  await assertSucceeds(anon().ref().update({ ['birthday-mates/' + k]: entry, ['bday-members/03-14/' + k]: { n: 'Guest One', f: 'Fisheries', t: 'g' } }));
  await assertFails(anon().ref('birthday-mates/' + k).update({ name: 'Changed' }), 'no overwrite');
  await assertFails(anon().ref('birthday-mates/' + LEGACY).remove(), 'no delete');
  await assertFails(anon().ref('bday-members/11-26/' + LEGACY).remove());
});

test('claiming a guest entry: name+birthday match (legacy) or token (new)', async () => {
  await seedProfiles();
  // dave has a different name -> cannot claim the legacy row
  await assertSucceeds(as('dave').ref().update(profileUpdate('dave', { name: 'Dave Das', birthday: '2003-11-26', vis: 'members' })));
  await assertFails(as('dave').ref().update({ ['bday-claims/' + LEGACY]: { uid: 'dave', at: TS }, ['bday-members/11-26/' + LEGACY]: null }));
  // the real owner (same name + full birthday)
  await assertSucceeds(as('olds').ref().update(profileUpdate('olds', { name: 'old student', birthday: '2003-11-26', vis: 'private' })));
  await assertFails(as('olds').ref().update({ ['bday-claims/' + LEGACY]: { uid: 'someone-else', at: TS }, ['bday-members/11-26/' + LEGACY]: null }));
  await assertSucceeds(as('olds').ref().update({ ['bday-claims/' + LEGACY]: { uid: 'olds', at: TS }, ['bday-members/11-26/' + LEGACY]: null }));
  assert.equal((await as('dave').ref('bday-members/11-26/' + LEGACY).get()).exists(), false, 'private now applies to the old row too');
  await assertFails(anon().ref().update({ ['bday-members/11-26/' + LEGACY]: { n: 'Old Student', f: 'Agriculture', t: 'g' } }), 'claimed rows cannot be re-created');

  // token claim for a new guest entry
  const k = '-NewGuestKey00000002';
  const tok = 'A'.repeat(32);
  await assertSucceeds(anon().ref().update({
    ['birthday-mates/' + k]: { name: 'Token Person', faculty: 'Fisheries', birthday: '2001-01-02', timestamp: 'x', claim: tok },
    ['bday-members/01-02/' + k]: { n: 'Token Person', f: 'Fisheries', t: 'g' }
  }));
  await assertSucceeds(as('tp').ref().update(profileUpdate('tp', { name: 'Different Display Name', birthday: '2001-01-02', vis: 'members' })));
  await assertFails(as('tp').ref().update({ ['bday-claims/' + k]: { uid: 'tp', token: 'B'.repeat(32), at: TS } }), 'wrong token');
  await assertSucceeds(as('tp').ref().update({ ['bday-claims/' + k]: { uid: 'tp', token: tok, at: TS }, ['bday-members/01-02/' + k]: null }));
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
  await assertSucceeds(adminDb().ref().update({ ['birthday-mates/' + LEGACY]: null, ['bday-members/11-26/' + LEGACY]: null }));
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
