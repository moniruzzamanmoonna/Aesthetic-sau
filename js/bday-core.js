/*
 * Birthday Mate — pure helpers (no DOM, no Firebase).
 * Works as a browser global (window.BdayCore) and as a CommonJS module (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BdayCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var FACULTIES = ['Agriculture', 'Fisheries', 'Veterinary, Animal and Biomedical Sciences',
    'Agricultural Economics & Business Studies', 'Agricultural Engineering & Technology',
    'Biotechnology & Genetic Engineering'];
  var DISTRICTS = ['Bagerhat', 'Bandarban', 'Barguna', 'Barishal', 'Bhola', 'Bogura', 'Brahmanbaria', 'Chandpur',
    'Chapai Nawabganj', 'Chattogram', 'Chuadanga', "Cox's Bazar", 'Cumilla', 'Dhaka', 'Dinajpur', 'Faridpur', 'Feni',
    'Gaibandha', 'Gazipur', 'Gopalganj', 'Habiganj', 'Jamalpur', 'Jashore', 'Jhalokati', 'Jhenaidah', 'Joypurhat',
    'Khagrachhari', 'Khulna', 'Kishoreganj', 'Kurigram', 'Kushtia', 'Lakshmipur', 'Lalmonirhat', 'Madaripur', 'Magura',
    'Manikganj', 'Meherpur', 'Moulvibazar', 'Munshiganj', 'Mymensingh', 'Naogaon', 'Narail', 'Narayanganj', 'Narsingdi',
    'Natore', 'Netrokona', 'Nilphamari', 'Noakhali', 'Pabna', 'Panchagarh', 'Patuakhali', 'Pirojpur', 'Rajbari',
    'Rajshahi', 'Rangamati', 'Rangpur', 'Satkhira', 'Shariatpur', 'Sherpur', 'Sirajganj', 'Sunamganj', 'Sylhet',
    'Tangail', 'Thakurgaon'];
  /** "Cox's Bazar" -> "cox-s-bazar" (same transform as the database rules). */
  function districtKey(name) { return String(name || '').toLowerCase().split(' ').join('-').split("'").join('-'); }
  function districtName(key) {
    for (var i = 0; i < DISTRICTS.length; i++) if (districtKey(DISTRICTS[i]) === key) return DISTRICTS[i];
    return '';
  }
  var WISH_MAX = 300;
  var NAME_MAX = 60;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

  /** "2005-06-03" -> {y:2005,m:6,d:3} or null when it is not a real calendar date. */
  function parseDob(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }

  /** A birthday is valid when it is a real date, not in the future and not absurdly old. */
  function validateDob(s, today) {
    var p = parseDob(s);
    if (!p) return 'Please enter a valid date of birth.';
    today = today || new Date();
    var t = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    var v = p.y * 10000 + p.m * 100 + p.d;
    if (v > t) return 'Date of birth cannot be in the future.';
    if (today.getFullYear() - p.y > 100) return 'Please check the year of birth.';
    return '';
  }

  /** Month-day key used by the index: "MM-DD". */
  function mdKey(m, d) { return pad(m) + '-' + pad(d); }
  function mdFromDob(s) { var p = parseDob(s); return p ? mdKey(p.m, p.d) : ''; }
  function mdFromDate(date) { return mdKey(date.getMonth() + 1, date.getDate()); }

  /**
   * Index keys whose birthdays are celebrated on `date`.
   * People born on 29 February celebrate on 28 February in non-leap years.
   */
  function celebrationKeys(date) {
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    var keys = [mdKey(m, d)];
    if (m === 2 && d === 28 && !isLeap(y)) keys.push('02-29');
    return keys;
  }

  /** "11-26" -> "26 November" (no year — the year is never shown). */
  function formatMd(md) {
    var p = /^(\d{2})-(\d{2})$/.exec(md || '');
    if (!p) return '';
    return (+p[2]) + ' ' + MONTHS[+p[1] - 1];
  }
  function formatLongDate(date) {
    return date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  /**
   * Month grid for the calendar (Sunday first).
   * Returns weeks: arrays of 7 cells, each null (padding) or
   *   { day, md, keys:[index keys shown on this cell], isToday }
   */
  function monthGrid(year, month, today) {
    var first = new Date(year, month - 1, 1).getDay();
    var n = daysInMonth(year, month);
    var cells = [];
    var i;
    for (i = 0; i < first; i++) cells.push(null);
    for (var d = 1; d <= n; d++) {
      var keys = [mdKey(month, d)];
      if (month === 2 && d === 28 && !isLeap(year)) keys.push('02-29');
      cells.push({
        day: d,
        md: mdKey(month, d),
        keys: keys,
        isToday: !!today && today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === d
      });
    }
    while (cells.length % 7) cells.push(null);
    var weeks = [];
    for (i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  function shiftMonth(year, month, delta) {
    var idx = year * 12 + (month - 1) + delta;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
  }

  /**
   * Turn raw index rows {key: {n,f,b,p,t}} (from one or more MM-DD nodes) into a
   * clean, de-duplicated list. Signed-in profiles ('u_' keys) win over guest rows
   * with the same name; `excludeKeys` removes the viewer's own rows.
   */
  function mergeEntries(groups, excludeKeys) {
    var ex = {};
    (excludeKeys || []).forEach(function (k) { if (k) ex[k] = 1; });
    var byName = {};
    var out = [];
    groups.forEach(function (g) {
      var rows = g.rows || {};
      Object.keys(rows).forEach(function (key) {
        var r = rows[key];
        if (!r || typeof r !== 'object' || ex[key]) return;
        var name = String(r.n || '').trim();
        if (!name) return;
        var item = {
          key: key,
          md: g.md,
          name: name,
          faculty: String(r.f || ''),
          batch: r.b ? String(r.b) : '',
          photo: r.p ? String(r.p) : '',
          anonbox: r.a && /^[a-z0-9_]{3,20}$/.test(String(r.a)) ? String(r.a) : '',
          uid: key.indexOf('u_') === 0 ? key.slice(2) : '',
          canWish: key.indexOf('u_') === 0,
          visibility: g.vis || ''
        };
        var nk = name.toLowerCase() + '|' + g.md;
        var prev = byName[nk];
        if (prev !== undefined) {
          if (!out[prev].canWish && item.canWish) out[prev] = item;
          return;
        }
        byName[nk] = out.length;
        out.push(item);
      });
    });
    out.sort(function (a, b) { return a.md < b.md ? -1 : a.md > b.md ? 1 : a.name.localeCompare(b.name); });
    return out;
  }

  /** Normalise + check a wish before sending. Returns {text, error}. */
  function checkWish(raw) {
    var text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return { text: '', error: 'Please write a birthday message.' };
    if (text.length > WISH_MAX) return { text: text, error: 'Please keep it under ' + WISH_MAX + ' characters.' };
    if (/(https?:|www\.)/i.test(text)) return { text: text, error: 'Links are not allowed in birthday wishes.' };
    if (/(.)\1{9,}/.test(text)) return { text: text, error: 'That looks like spam — please write a real message.' };
    return { text: text, error: '' };
  }

  /**
   * AnonBox username from what the user typed: "moonstar", "@moonstar" or a pasted link like
   * "https://anon-box2026.web.app/u/moonstar". Returns '' for empty, null when invalid.
   */
  function parseAnonBox(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    var m = /\/u\/([^/?#\s]+)/.exec(s);
    if (m) s = m[1];
    s = s.replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_]{3,20}$/.test(s) ? s : null;
  }
  var ANONBOX_BASE = 'https://anon-box2026.web.app/u/';

  function cleanName(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  // Firebase-style push id (time-ordered, 20 chars, starts with '-').
  var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  function pushId(now, rand) {
    now = now == null ? Date.now() : now;
    rand = rand || Math.random;
    var t = '';
    for (var i = 0; i < 8; i++) { t = PUSH_CHARS.charAt(now % 64) + t; now = Math.floor(now / 64); }
    for (var k = 0; k < 12; k++) t += PUSH_CHARS.charAt(Math.floor(rand() * 64));
    return t.charAt(0) === '-' ? t : '-' + t.slice(1);
  }

  function randomToken(len) {
    var a = '';
    var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var buf = null;
    try { buf = new Uint32Array(len); (self.crypto || crypto).getRandomValues(buf); } catch (e) { buf = null; }
    for (var i = 0; i < len; i++) a += c.charAt((buf ? buf[i] : Math.floor(Math.random() * 4294967296)) % c.length);
    return a;
  }

  return {
    MONTHS: MONTHS, FACULTIES: FACULTIES, DISTRICTS: DISTRICTS, districtKey: districtKey, districtName: districtName, WISH_MAX: WISH_MAX, NAME_MAX: NAME_MAX,
    isLeap: isLeap, daysInMonth: daysInMonth, parseDob: parseDob, validateDob: validateDob,
    mdKey: mdKey, mdFromDob: mdFromDob, mdFromDate: mdFromDate, celebrationKeys: celebrationKeys,
    formatMd: formatMd, formatLongDate: formatLongDate, monthGrid: monthGrid, shiftMonth: shiftMonth,
    mergeEntries: mergeEntries, checkWish: checkWish, cleanName: cleanName, parseAnonBox: parseAnonBox, ANONBOX_BASE: ANONBOX_BASE, initials: initials,
    pushId: pushId, randomToken: randomToken
  };
});
