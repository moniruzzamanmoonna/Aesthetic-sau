/*
 * Birthday Mate — data layer (Firebase Auth + Realtime Database).
 *
 * Loaded as an ES module by birthday.html and index.html. It also publishes
 * window.BdayMate so the classic (non-module) scripts in index.html can use it.
 *
 * Database layout (see tools/build-db-rules.js for the security rules):
 *   birthday-mates/{key}          full guest/legacy entry ........ admin only
 *   profiles/{uid}                signed-in user's own profile ... owner + admin
 *   bday-public/{MM-DD}/{key}     {n,f,b?,p?,t} .................. anyone
 *   bday-members/{MM-DD}/{key}    {n,f,b?,p?,t} .................. signed-in users
 *   bday-claims/{key}             guest entry -> uid link ........ admin only
 *   wishes/{toUid}/{wid}          {msg,anon,fromName?,at,...} .... recipient + admin
 *   wish-meta/{wid}               {from,to,at} ................... admin only
 *   wish-rate/{uid}, wish-pair/{uid}/{toUid}  rate limits ........ owner
 * Keys: guest rows use the birthday-mates push key, profile rows use "u_" + uid.
 */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut as fbSignOut, connectAuthEmulator, signInAnonymously
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getDatabase, ref, get, update, push, query, orderByKey, startAt, endAt, serverTimestamp, onValue, connectDatabaseEmulator, increment
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import './bday-core.js';

const C = self.BdayCore;
const CONFIG = {
  apiKey: 'AIzaSyD5Ee8qZulCbxGPa3w7UdgEwYscfb8pxck',
  authDomain: 'aesthetic-sau.firebaseapp.com',
  databaseURL: 'https://aesthetic-sau-default-rtdb.firebaseio.com',
  projectId: 'aesthetic-sau',
  appId: '1:584202645287:web:7893dd0af00cdb04d30302'
};
const APP_NAME = 'sau-bday';
const app = getApps().find(function (a) { return a.name === APP_NAME; }) || initializeApp(CONFIG, APP_NAME);
const auth = getAuth(app);
const db = getDatabase(app);
const GUEST_KEY = 'sau_bday_entry';

// Local testing only: on localhost, "?emulator" routes Auth + Database to the Firebase emulators
// (remembered for the browser tab). Has no effect on the live domain.
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  try {
    if (/[?&]emulator\b/.test(location.search)) sessionStorage.setItem('bm_emulator', '1');
    if (sessionStorage.getItem('bm_emulator') === '1') {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectDatabaseEmulator(db, '127.0.0.1', 9000);
    }
  } catch (e) { console.warn('[BirthdayMate] emulator', e); }
}

// ── auth ──────────────────────────────────────────────────────────────
// currentUser = the Google-signed-in user (or null). Visitors who send a wish without signing in
// get an invisible anonymous Firebase session (authUser) — the app never treats that as signed in.
let currentUser = null;
let authUser = null;
let profileCache; // undefined = not loaded, null = no profile
const listeners = new Set();
let resolveReady;
const ready = new Promise(function (r) { resolveReady = r; });

let lastRealUid;
onAuthStateChanged(auth, function (u) {
  authUser = u;
  const real = u && !u.isAnonymous ? u : null;
  const changed = (real ? real.uid : null) !== lastRealUid;
  currentUser = real;
  lastRealUid = real ? real.uid : null;
  resolveReady();
  if (!changed) return; // e.g. a visitor got an anonymous session just to send a wish
  profileCache = undefined;
  adminCache = null;
  listeners.forEach(function (fn) { try { fn(real); } catch (e) { console.error(e); } });
});
getRedirectResult(auth).catch(function (e) { console.warn('[BirthdayMate] redirect sign-in failed:', e && e.code); });

function onUser(fn) { listeners.add(fn); if (currentUser !== null || authSettled()) fn(currentUser); return function () { listeners.delete(fn); }; }
let settled = false; ready.then(function () { settled = true; });
function authSettled() { return settled; }
function user() { return currentUser; }

/** Google blocks sign-in inside Facebook/Instagram/Messenger in-app browsers. */
function inAppBrowser() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|; wv\)/i.test(ua);
}

async function signIn() {
  if (inAppBrowser()) {
    const err = new Error('in-app-browser');
    err.code = 'bday/in-app-browser';
    throw err;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}
function signOut() { return fbSignOut(auth); }
async function getIdToken() { return currentUser ? currentUser.getIdToken() : ''; }

let adminCache = null;
async function isAdmin() {
  await ready;
  if (!currentUser) return false;
  if (adminCache && adminCache.uid === currentUser.uid) return adminCache.ok;
  let ok = false;
  try { await get(ref(db, 'admin-check')); ok = true; } catch (e) { ok = false; }
  adminCache = { uid: currentUser.uid, ok: ok };
  return ok;
}

// ── local guest entry (no-login registrations) ────────────────────────
function guestEntry() {
  try {
    const g = JSON.parse(localStorage.getItem(GUEST_KEY));
    return g && g.name && g.birthday ? g : null;
  } catch (e) { return null; }
}

/**
 * Register without logging in (keeps the original Birthday Mate form working).
 * The full entry is admin-only; only name + faculty + day/month become visible,
 * and only to signed-in members.
 */
async function registerGuest(entry) {
  const name = C.cleanName(entry.name);
  const err = C.validateDob(entry.birthday);
  if (name.length < 2) throw new Error('Please enter your name.');
  if (err) throw new Error(err);
  if (!entry.faculty) throw new Error('Please select your faculty.');
  const key = C.pushId();
  const md = C.mdFromDob(entry.birthday);
  const token = C.randomToken(32);
  const full = {
    name: name,
    faculty: String(entry.faculty).slice(0, 80),
    district: String(entry.district || '').slice(0, 40),
    birthday: entry.birthday,
    timestamp: new Date().toISOString(),
    claim: token
  };
  const gmail = String(entry.gmail || '').trim();
  if (gmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmail) || gmail.length > 100) throw new Error('Please enter a valid email address or leave it empty.');
    full.gmail = gmail;
  }
  const upd = {};
  upd['birthday-mates/' + key] = full;
  upd['bday-public/' + md + '/' + key] = { n: full.name, f: full.faculty, t: 'g' };
  upd['bday-marks/' + md + '/' + key] = true;
  await update(ref(db), upd);
  const local = { name: full.name, faculty: full.faculty, birthday: full.birthday, district: full.district, key: key, token: token };
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(local)); } catch (e) {}
  return local;
}

// ── profiles ──────────────────────────────────────────────────────────
async function getProfile(force) {
  await ready;
  if (!currentUser) return null;
  if (profileCache !== undefined && !force) return profileCache;
  const s = await get(ref(db, 'profiles/' + currentUser.uid));
  profileCache = s.exists() ? s.val() : null;
  return profileCache;
}

function indexRow(p) {
  const row = { n: p.name, f: p.faculty, t: 'u' };
  if (p.batch) row.b = p.batch;
  if (p.photo) row.p = p.photo;
  if (p.anonbox) row.a = p.anonbox;
  return row;
}

/**
 * Create or update the signed-in user's profile and its index row in one
 * atomic write (the rules reject a profile whose index row does not match).
 */
/**
 * District rows + counts for a profile change (old -> next, either may be null).
 * Rows follow the birthday visibility; counts include everyone who isn't private.
 */
function districtUpdates(upd, uid, old, next) {
  const counted = function (p) { return !!(p && p.district && p.visibility !== 'private'); };
  const oldDk = old && old.district ? C.districtKey(old.district) : '';
  const newDk = next && next.district ? C.districtKey(next.district) : '';
  if (oldDk && oldDk !== newDk) {
    upd['district-public/' + oldDk + '/u_' + uid] = null;
    upd['district-members/' + oldDk + '/u_' + uid] = null;
  }
  if (newDk) {
    const row = { n: next.name, f: next.faculty };
    if (next.batch) row.b = next.batch;
    if (next.photo) row.p = next.photo;
    if (next.anonbox) row.a = next.anonbox;
    upd['district-public/' + newDk + '/u_' + uid] = next.visibility === 'public' ? row : null;
    upd['district-members/' + newDk + '/u_' + uid] = next.visibility === 'members' ? row : null;
  }
  const wasIn = counted(old), isIn = counted(next);
  if (isIn && !(wasIn && oldDk === newDk)) upd['district-counts/' + newDk] = increment(1);
  if (wasIn && !(isIn && oldDk === newDk)) upd['district-counts/' + oldDk] = increment(-1);
}

async function saveProfile(input) {
  await ready;
  if (!currentUser) throw new Error('Please sign in first.');
  const uid = currentUser.uid;
  const old = await getProfile(true);
  const name = C.cleanName(input.name);
  if (name.length < 2) throw new Error('Please enter your name (at least 2 letters).');
  if (C.FACULTIES.indexOf(input.faculty) < 0 && !(old && old.faculty === input.faculty)) throw new Error('Please select your faculty.');
  const batch = String(input.batch || '').replace(/\s+/g, ' ').trim();
  if (batch && (batch.length > 20 || !/^[A-Za-z0-9 ._/-]+$/.test(batch))) throw new Error('Batch can use letters, numbers, spaces, "-", "/" and "." (max 20).');
  const birthday = old ? old.birthday : input.birthday;
  const dobErr = C.validateDob(birthday);
  if (dobErr) throw new Error(dobErr);
  const vis = ['public', 'members', 'private'].indexOf(input.visibility) >= 0 ? input.visibility : 'public';
  const photo = input.showPhoto && currentUser.photoURL && currentUser.photoURL.indexOf('https://lh3.googleusercontent.com/') === 0 &&
    currentUser.photoURL.length <= 400 ? currentUser.photoURL : null;
  const md = C.mdFromDob(birthday);
  const p = {
    name: name, faculty: input.faculty, birthday: birthday, md: md, visibility: vis,
    createdAt: old ? old.createdAt : serverTimestamp(), updatedAt: serverTimestamp()
  };
  if (batch) p.batch = batch;
  if (photo) p.photo = photo;
  const district = String(input.district || '').trim();
  if (district && C.DISTRICTS.indexOf(district) < 0) throw new Error('Please pick your district from the list.');
  if (district) p.district = district;
  const anonbox = C.parseAnonBox(input.anonbox);
  if (anonbox === null) throw new Error('AnonBox username: 3–20 letters, numbers or _ (or paste your AnonBox link).');
  if (anonbox) p.anonbox = anonbox;

  const upd = {};
  upd['profiles/' + uid] = p;
  districtUpdates(upd, uid, old, p);
  upd['bday-public/' + md + '/u_' + uid] = vis === 'public' ? indexRow(p) : null;
  upd['bday-members/' + md + '/u_' + uid] = vis === 'members' ? indexRow(p) : null;
  upd['bday-marks/' + md + '/u_' + uid] = vis === 'private' ? null : true;
  await update(ref(db), upd);
  profileCache = Object.assign({}, p, { createdAt: old ? old.createdAt : Date.now(), updatedAt: Date.now() });
  let claimed = false;
  try { claimed = await claimGuest(); } catch (e) { /* claiming is best effort */ }
  return { profile: profileCache, claimed: claimed };
}

/**
 * If this browser registered as a guest before, link that entry to the account
 * and remove its separate (members-only) index row, so the person's privacy
 * choice applies to them everywhere.
 */
async function claimGuest() {
  const g = guestEntry();
  const p = profileCache;
  if (!g || !g.key || !p || !currentUser || g.claimedBy === currentUser.uid) return false;
  const md = C.mdFromDob(g.birthday);
  if (!md) return false;
  const upd = {};
  const claim = { uid: currentUser.uid, at: serverTimestamp() };
  if (g.token) claim.token = g.token;
  upd['bday-claims/' + g.key] = claim;
  upd['bday-members/' + md + '/' + g.key] = null;
  upd['bday-public/' + md + '/' + g.key] = null;
  upd['bday-marks/' + md + '/' + g.key] = null;
  await update(ref(db), upd);
  g.claimedBy = currentUser.uid;
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch (e) {}
  return true;
}

/**
 * Earlier (no-login) registrations on the same day + month as the signed-in user's profile.
 * Shown in the "Is one of these you?" popup. Only name + faculty are visible.
 */
async function claimCandidates() {
  const p = await getProfile(true);
  if (!p || !p.md) return [];
  let rows = {};
  const [pubS, memS] = await Promise.all([
    get(ref(db, 'bday-public/' + p.md)).catch(function () { return null; }),
    get(ref(db, 'bday-members/' + p.md)).catch(function () { return null; })
  ]);
  rows = Object.assign({}, (pubS && pubS.val()) || {}, (memS && memS.val()) || {});
  const g = guestEntry();
  return Object.keys(rows || {}).filter(function (k) {
    const r = rows[k];
    return r && r.t === 'g' && !(g && g.key === k && g.claimedBy);
  }).map(function (k) { return { key: k, name: String(rows[k].n || ''), faculty: String(rows[k].f || ''), md: p.md }; });
}

/**
 * "Yes, that's me": link an earlier registration to this account. The rules only allow it
 * when that entry's full date of birth (including the year, never shown) matches the profile.
 */
async function claimEntry(key) {
  await ready;
  const p = await getProfile(true);
  if (!currentUser || !p) throw new Error('Please create your profile first.');
  const upd = {};
  upd['bday-claims/' + key] = { uid: currentUser.uid, at: serverTimestamp() };
  upd['bday-members/' + p.md + '/' + key] = null;
  upd['bday-public/' + p.md + '/' + key] = null;
  upd['bday-marks/' + p.md + '/' + key] = null;
  try {
    await update(ref(db), upd);
  } catch (e) {
    if (friendly(e) === 'permission') throw new Error("This entry's date of birth (year) doesn't match yours, so it can't be linked. You'll continue as a new user.");
    throw new Error('Could not link the entry. Please check your connection and try again.');
  }
  return true;
}

async function deleteProfile() {
  await ready;
  if (!currentUser) return;
  const p = await getProfile(true);
  if (!p) return;
  const uid = currentUser.uid;
  const upd = {};
  upd['bday-public/' + p.md + '/u_' + uid] = null;
  upd['bday-members/' + p.md + '/u_' + uid] = null;
  upd['bday-marks/' + p.md + '/u_' + uid] = null;
  upd['profiles/' + uid] = null;
  districtUpdates(upd, uid, p, null);
  await update(ref(db), upd);
  profileCache = null;
}

// ── reading birthdays (only ever one day or one month) ───────────────
/**
 * Give-to-get: members-only birthdays are visible only to signed-in users who share their
 * own birthday (Public or SAU Members Only). Enforced by the database rules too.
 */
async function access() {
  await ready;
  if (!currentUser) return { signedIn: false, hasProfile: false, sharing: false, visibility: '' };
  let p = null;
  try { p = await getProfile(); } catch (e) { p = null; }
  const vis = p ? p.visibility : '';
  return { signedIn: true, hasProfile: !!p, sharing: vis === 'public' || vis === 'members', visibility: vis };
}
async function canSeeMembers() { return (await access()).sharing; }

async function readDay(md) {
  const tasks = [get(ref(db, 'bday-public/' + md)).then(function (s) { return { md: md, vis: 'public', rows: s.val() }; })];
  if (await canSeeMembers()) {
    tasks.push(get(ref(db, 'bday-members/' + md)).then(function (s) { return { md: md, vis: 'members', rows: s.val() }; }));
  }
  return Promise.all(tasks);
}

function ownKeys() {
  const keys = [];
  if (currentUser) keys.push('u_' + currentUser.uid);
  const g = guestEntry();
  if (g && g.key) keys.push(g.key);
  return keys;
}

/** Birthdays celebrated on `date` (29 Feb birthdays show on 28 Feb in common years). */
async function birthdaysOn(date) {
  await ready;
  const keys = C.celebrationKeys(date || new Date());
  const groups = [].concat.apply([], await Promise.all(keys.map(readDay)));
  return C.mergeEntries(groups, []).map(markSelf);
}

function markSelf(item) {
  const own = ownKeys();
  item.isSelf = own.indexOf(item.key) >= 0;
  return item;
}

/** The viewer's birthday as MM-DD: from their profile, else from a guest entry on this device. */
async function myMd() {
  await ready;
  const p = currentUser ? await getProfile() : null;
  if (p && p.md) return { md: p.md, source: 'profile' };
  const g = guestEntry();
  if (g) return { md: C.mdFromDob(g.birthday), source: 'guest' };
  return { md: '', source: '' };
}

/** People who share the exact day and month (any year). */
async function twins() {
  const me = await myMd();
  if (!me.md) return { md: '', items: [], membersHidden: !(await canSeeMembers()), source: '' };
  const groups = await readDay(me.md);
  const items = C.mergeEntries(groups, ownKeys());
  return { md: me.md, items: items, membersHidden: !(await canSeeMembers()), source: me.source };
}

/**
 * How many birthdays on these days the viewer can't see (members-only rows while signed out,
 * private, or without a profile). Uses bday-marks, which holds no names.
 */
async function hiddenOn(mdKeys, exclude) {
  await ready;
  if (await canSeeMembers()) return 0;
  const ex = {};
  (exclude || ownKeys()).forEach(function (k) { ex[k] = 1; });
  let n = 0;
  await Promise.all(mdKeys.map(async function (md) {
    const [m, p] = await Promise.all([get(ref(db, 'bday-marks/' + md)), get(ref(db, 'bday-public/' + md))]);
    const pub = p.val() || {};
    Object.keys(m.val() || {}).forEach(function (k) { if (!pub[k] && !ex[k]) n++; });
  }));
  return n;
}

/**
 * One month of birthdays: { byMd: { 'MM-DD': [visible items] }, hidden: { 'MM-DD': count } }.
 * `hidden` counts birthdays the viewer can't see, so the calendar can still show 🎂 marks.
 */
async function month(year, monthNum) {
  await ready;
  const mm = (monthNum < 10 ? '0' : '') + monthNum;
  const sharing = await canSeeMembers();
  const nodes = ['bday-public'];
  if (sharing) nodes.push('bday-members');
  const range = function (n) { return get(query(ref(db, n), orderByKey(), startAt(mm + '-01'), endAt(mm + '-31'))); };
  const [snaps, marksSnap] = await Promise.all([Promise.all(nodes.map(range)), sharing ? Promise.resolve(null) : range('bday-marks')]);
  const groups = [];
  snaps.forEach(function (s, i) {
    const v = s.val() || {};
    Object.keys(v).forEach(function (md) { groups.push({ md: md, vis: nodes[i] === 'bday-public' ? 'public' : 'members', rows: v[md] }); });
  });
  const byMd = {};
  C.mergeEntries(groups, []).forEach(function (it) {
    markSelf(it);
    (byMd[it.md] = byMd[it.md] || []).push(it);
  });
  const hidden = {};
  if (marksSnap) {
    const marks = marksSnap.val() || {};
    const pub = snaps[0].val() || {};
    const ex = {};
    ownKeys().forEach(function (k) { ex[k] = 1; });
    Object.keys(marks).forEach(function (md) {
      const n = Object.keys(marks[md] || {}).filter(function (k) { return !(pub[md] || {})[k] && !ex[k]; }).length;
      if (n) hidden[md] = n;
    });
  }
  return { byMd: byMd, hidden: hidden };
}
// ── 📍 District Mates ─────────────────────────────────────────────────
/**
 * People per district: { total, live, legacy } maps of district key -> number.
 * live = profiles (can be shown, per visibility); legacy = earlier registrations (always anonymous).
 */
async function districtCounts() {
  const [liveS, legacyS] = await Promise.all([get(ref(db, 'district-counts')), get(ref(db, 'district-legacy'))]);
  const live = liveS.val() || {}, legacy = legacyS.val() || {}, total = {};
  [live, legacy].forEach(function (o) {
    Object.keys(o).forEach(function (k) { total[k] = (total[k] || 0) + (+o[k] || 0); });
  });
  return { total: total, live: live, legacy: legacy };
}
/** Visible people from one district (public, plus members-only for people who share). */
async function districtPeople(dk) {
  await ready;
  const nodes = ['district-public'];
  if (await canSeeMembers()) nodes.push('district-members');
  const snaps = await Promise.all(nodes.map(function (n) { return get(ref(db, n + '/' + dk)); }));
  const me = currentUser ? 'u_' + currentUser.uid : '';
  const out = [];
  snaps.forEach(function (s) {
    const v = s.val() || {};
    Object.keys(v).forEach(function (k) {
      const r = v[k];
      if (!r || !r.n) return;
      out.push({ key: k, name: String(r.n), faculty: String(r.f || ''), batch: r.b ? String(r.b) : '', photo: r.p ? String(r.p) : '',
        uid: k.slice(2), canWish: true, isSelf: k === me, md: '', anonbox: r.a ? String(r.a) : '' });
    });
  });
  out.sort(function (a, b) { return a.isSelf - b.isSelf || a.name.localeCompare(b.name); });
  return out;
}

// ── wishes ────────────────────────────────────────────────────────────
let serverOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), function (s) { serverOffset = s.val() || 0; });
function serverNow() { return Date.now() + serverOffset; }

function friendly(e) {
  const code = (e && (e.code || e.message)) || '';
  if (/PERMISSION_DENIED|permission/i.test(code)) return 'permission';
  if (/network|offline|unavailable/i.test(code)) return 'network';
  return 'unknown';
}

async function sendWish(toUid, rawText, anonymous) {
  await ready;
  // No Google account? Send through an invisible anonymous session (still rate-limited, and an
  // admin can trace abuse to the device session if a wish is reported).
  if (!authUser) {
    try { await signInAnonymously(auth); } catch (e) { throw new Error('Could not connect. Please check your internet and try again.'); }
  }
  const sender = auth.currentUser;
  const uid = sender.uid;
  if (sender.isAnonymous) anonymous = true;
  if (!toUid || toUid === uid) throw new Error("You can't send a wish to yourself.");
  const chk = C.checkWish(rawText);
  if (chk.error) throw new Error(chk.error);

  const [rateSnap, pairSnap] = await Promise.all([
    get(ref(db, 'wish-rate/' + uid)),
    get(ref(db, 'wish-pair/' + uid + '/' + toUid))
  ]);
  const now = serverNow();
  const pairAt = pairSnap.val();
  if (pairAt && now - pairAt < 72000000) throw new Error('You already sent this person a wish today. Try again tomorrow. 💚');
  const rate = rateSnap.val();
  let win = serverTimestamp();
  let n = 1;
  if (rate) {
    if (now - rate.last < 30000) throw new Error('Please wait a few seconds before sending another wish.');
    if (now - rate.win < 86400000) {
      if (rate.n >= 10) throw new Error("You've reached today's limit of 10 wishes. Try again tomorrow.");
      win = rate.win; n = rate.n + 1;
    }
  }
  let fromName = null;
  if (!anonymous) {
    const p = await getProfile();
    if (!p) throw new Error('Create your Birthday Mate profile to send a wish with your name, or send it anonymously.');
    fromName = p.name;
  }
  const wid = push(ref(db, 'wish-meta')).key;
  const wish = { msg: chk.text, anon: !!anonymous, at: serverTimestamp() };
  if (fromName) wish.fromName = fromName;
  const upd = {};
  upd['wishes/' + toUid + '/' + wid] = wish;
  upd['wish-meta/' + wid] = { from: uid, to: toUid, at: serverTimestamp() };
  upd['wish-rate/' + uid] = { last: serverTimestamp(), win: win, n: n };
  upd['wish-pair/' + uid + '/' + toUid] = serverTimestamp();
  try {
    await update(ref(db), upd);
  } catch (e) {
    if (friendly(e) === 'permission') throw new Error("This wish couldn't be sent. The person may have made their birthday private, or you've hit the sending limit.");
    if (friendly(e) === 'network') throw new Error('No connection. Please check your internet and try again.');
    throw e;
  }
  return wid;
}

async function myWishes() {
  await ready;
  if (!currentUser) return [];
  const s = await get(ref(db, 'wishes/' + currentUser.uid));
  const v = s.val() || {};
  return Object.keys(v).map(function (id) {
    const w = v[id];
    return { id: id, msg: String(w.msg || ''), anon: w.anon !== false, fromName: w.anon === false ? String(w.fromName || '') : '', at: w.at || 0, reported: !!w.reported };
  }).sort(function (a, b) { return b.at - a.at; });
}

function watchWishCount(fn) {
  let off = null;
  return onUser(function (u) {
    if (off) { off(); off = null; }
    if (!u) { fn(0, 0); return; }
    off = onValue(ref(db, 'wishes/' + u.uid), function (s) {
      const v = s.val() || {};
      const seen = seenAt(u.uid);
      let total = 0, fresh = 0;
      Object.keys(v).forEach(function (k) { total++; if ((v[k].at || 0) > seen) fresh++; });
      fn(fresh, total);
    }, function () { fn(0, 0); });
  });
}
function seenAt(uid) { try { return +localStorage.getItem('sau_wish_seen_' + uid) || 0; } catch (e) { return 0; } }
function markWishesSeen() { if (currentUser) try { localStorage.setItem('sau_wish_seen_' + currentUser.uid, String(serverNow())); } catch (e) {} }

async function reportWish(id) {
  if (!currentUser) return;
  const base = 'wishes/' + currentUser.uid + '/' + id;
  const upd = {};
  upd[base + '/reported'] = true;
  upd[base + '/reportedAt'] = serverTimestamp();
  await update(ref(db), upd);
}
async function deleteWish(id) {
  if (!currentUser) return;
  const upd = {};
  upd['wishes/' + currentUser.uid + '/' + id] = null;
  await update(ref(db), upd);
}

// ── admin moderation ──────────────────────────────────────────────────
async function adminWishes() {
  if (!(await isAdmin())) throw new Error('Not an admin.');
  const [meta, wishes, profiles] = await Promise.all([
    get(ref(db, 'wish-meta')), get(ref(db, 'wishes')), get(ref(db, 'profiles'))
  ]);
  const m = meta.val() || {}, w = wishes.val() || {}, p = profiles.val() || {};
  const pname = function (uid) { return (p[uid] && p[uid].name) || ''; };
  return Object.keys(m).map(function (id) {
    const mm = m[id];
    const ww = (w[mm.to] || {})[id] || null;
    return {
      id: id, from: mm.from, to: mm.to, at: mm.at || 0, fromName: pname(mm.from), toName: pname(mm.to),
      msg: ww ? String(ww.msg || '') : '', anon: ww ? ww.anon !== false : true, reported: !!(ww && ww.reported),
      reportedAt: ww && ww.reportedAt || 0, removed: !ww, removedAt: mm.removedAt || 0
    };
  }).sort(function (a, b) { return (b.reported - a.reported) || (b.at - a.at); });
}
async function adminRemoveWish(id, to) {
  if (!(await isAdmin())) throw new Error('Not an admin.');
  const upd = {};
  upd['wishes/' + to + '/' + id] = null;
  upd['wish-meta/' + id + '/removedAt'] = serverTimestamp();
  await update(ref(db), upd);
}
/** Admin: full guest/legacy entries (birthday-mates). */
async function adminBirthdayMates() {
  if (!(await isAdmin())) throw new Error('Not an admin.');
  const [bm, claims] = await Promise.all([get(ref(db, 'birthday-mates')), get(ref(db, 'bday-claims'))]);
  return { entries: bm.val() || {}, claims: claims.val() || {} };
}
/** Admin: delete a guest/legacy entry together with its index rows. */
async function adminDeleteEntry(key, birthday) {
  const md = C.mdFromDob(birthday);
  const upd = {};
  upd['birthday-mates/' + key] = null;
  if (md) { upd['bday-members/' + md + '/' + key] = null; upd['bday-public/' + md + '/' + key] = null; upd['bday-marks/' + md + '/' + key] = null; }
  await update(ref(db), upd);
}
/** Admin: edit a guest/legacy entry and keep its index row in sync. */
async function adminEditEntry(key, before, after, claimed) {
  const oldMd = C.mdFromDob(before.birthday);
  const newMd = C.mdFromDob(after.birthday);
  if (!newMd) throw new Error('Invalid date of birth.');
  const upd = {};
  upd['birthday-mates/' + key + '/name'] = C.cleanName(after.name);
  upd['birthday-mates/' + key + '/faculty'] = after.faculty;
  upd['birthday-mates/' + key + '/birthday'] = after.birthday;
  if (!claimed) {
    const node = oldMd && (await get(ref(db, 'bday-members/' + oldMd + '/' + key))).exists() ? 'bday-members' : 'bday-public';
    if (oldMd && oldMd !== newMd) {
      upd['bday-members/' + oldMd + '/' + key] = null; upd['bday-public/' + oldMd + '/' + key] = null; upd['bday-marks/' + oldMd + '/' + key] = null;
    }
    upd[node + '/' + newMd + '/' + key] = { n: C.cleanName(after.name), f: after.faculty, t: 'g' };
    upd['bday-marks/' + newMd + '/' + key] = true;
  }
  await update(ref(db), upd);
}

const api = {
  ready, onUser, user, signIn, signOut, getIdToken, isAdmin, inAppBrowser,
  guestEntry, registerGuest, getProfile, saveProfile, deleteProfile, claimGuest,
  birthdaysOn, twins, month, myMd, hiddenOn, districtCounts, districtPeople, access, claimCandidates, claimEntry,
  sendWish, myWishes, watchWishCount, markWishesSeen, reportWish, deleteWish,
  adminWishes, adminRemoveWish, adminBirthdayMates, adminDeleteEntry, adminEditEntry,
  core: C
};
self.BdayMate = api;
try { self.dispatchEvent(new CustomEvent('bdaymate:ready')); } catch (e) {}
export default api;
