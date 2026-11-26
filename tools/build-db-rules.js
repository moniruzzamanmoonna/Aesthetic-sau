#!/usr/bin/env node
/*
 * Builds database.rules.json for the aesthetic-sau Realtime Database.
 *
 *   node tools/build-db-rules.js            -> writes ../database.rules.json
 *
 * tools/db-rules.base.json is a copy of the rules that were live before the
 * Birthday Mate upgrade (visitor counters, games, ratings, ...). They are kept
 * as-is; only the Birthday Mate nodes below are replaced/added.
 *
 * Deploy (rules only, never touches hosting):
 *   firebase deploy --only database --project aesthetic-sau
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ADMIN_EMAILS = ['aestheticsau3100@gmail.com', 'moniruzzamanmoonna@gmail.com'];

// ── shared expressions ────────────────────────────────────────────────
const ADMIN = '(auth != null && auth.token.email_verified === true && (' +
  ADMIN_EMAILS.map(function (e) { return "auth.token.email === '" + e + "'"; }).join(' || ') + '))';
const SIGNED = 'auth != null';
// Month-day key "MM-DD" (rejects 04-31, 02-30 ...). 02-29 is allowed.
const MD_RE = '/^((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-9]))$/';
const DOB_RE = '/^(19[0-9][0-9]|20[0-9][0-9])-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-9]))$/';
const PHOTO_OK = "newData.isString() && newData.val().beginsWith('https://lh3.googleusercontent.com/') && newData.val().length <= 400";
const str = function (min, max) {
  return 'newData.isString() && newData.val().length >= ' + min + ' && newData.val().length <= ' + max;
};
const NOW_ONCE = '(data.exists() && newData.val() === data.val()) || (!data.exists() && newData.val() === now)';
const j = function () { return Array.prototype.join.call(arguments, ' '); };

// ── public birthday index (bday-public / bday-members) ────────────────
// path: bday-<vis>/$md/$key   ->  root = newData.parent().parent().parent()
function indexNode(vis, readRule) {
  const NR = 'newData.parent().parent().parent()';
  const P = NR + ".child('profiles').child(auth.uid)";
  const G = NR + ".child('birthday-mates').child($key)";
  const ownProfile = j(
    "(" + SIGNED + " && $key === 'u_' + auth.uid && (!newData.exists() || (",
    P + ".child('md').val() === $md",
    "&& " + P + ".child('visibility').val() === '" + vis + "'",
    "&& newData.child('t').val() === 'u'",
    "&& newData.child('n').val() === " + P + ".child('name').val()",
    "&& newData.child('f').val() === " + P + ".child('faculty').val()",
    "&& ((!newData.child('b').exists() && !" + P + ".child('batch').exists()) || newData.child('b').val() === " + P + ".child('batch').val())",
    "&& ((!newData.child('p').exists() && !" + P + ".child('photo').exists()) || newData.child('p').val() === " + P + ".child('photo').val())",
    ')))'
  );
  // Guest (no-login) entries are only ever indexed as members-only.
  const guestCreate = vis !== 'members' ? 'false' : j(
    "(!data.exists() && newData.exists() && !$key.beginsWith('u_')",
    "&& " + G + ".exists()",
    "&& " + G + ".child('birthday').val().endsWith('-' + $md)",
    "&& newData.child('t').val() === 'g'",
    "&& newData.child('n').val() === " + G + ".child('name').val()",
    "&& newData.child('f').val() === " + G + ".child('faculty').val()",
    "&& !newData.child('b').exists() && !newData.child('p').exists()",
    "&& !" + NR + ".child('bday-claims').child($key).exists())"
  );
  // A signed-in user who claimed a guest entry may remove its index row.
  const claimDelete = "(!newData.exists() && " + SIGNED + " && " + NR +
    ".child('bday-claims').child($key).child('uid').val() === auth.uid)";

  const md = {
    '.validate': '$md.matches(' + MD_RE + ')',
      '$key': {
        // ...and the public count marker (bday-marks) must stay in step with the rows.
        '.write': '(' + [ADMIN, ownProfile, guestCreate, claimDelete].join(' || ') + ') && ' + markConsistent(NR),
        '.validate': "newData.hasChildren(['n','f','t'])",
        n: { '.validate': str(1, 60) },
        f: { '.validate': str(1, 80) },
        b: { '.validate': str(1, 20) },
        p: { '.validate': PHOTO_OK },
        t: { '.validate': "newData.val() === 'u' || newData.val() === 'g'" },
        $other: { '.validate': false }
      }
  };
  // Members-only rows: also readable for your own birthday (MM-DD) so a new user can be
  // asked "is one of these earlier registrations you?" even before sharing.
  if (vis === 'members') {
    md['.read'] = SIGNED + " && root.child('profiles').child(auth.uid).child('md').val() === $md";
  }
  return { '.read': readRule, '$md': md };
}

// bday-marks/$md/$key mirrors "this key has a visible row on this day" (public or members-only).
// It holds no names, so anyone can read it: that is how signed-out visitors see 🎂 counts on the
// calendar. After every write the marker must exist exactly when a row exists.
function markConsistent(NR) {
  return '((' + NR + ".child('bday-public').child($md).child($key).exists() || " + NR +
    ".child('bday-members').child($md).child($key).exists()) === " + NR + ".child('bday-marks').child($md).child($key).exists())";
}
function marksNode() {
  const NR = 'newData.parent().parent().parent()';
  return {
    '.read': 'true',
    '$md': {
      '.validate': '$md.matches(' + MD_RE + ')',
      '$key': { '.write': markConsistent(NR), '.validate': 'newData.val() === true' }
    }
  };
}

// Give-to-get: only people who share their own birthday (Public or SAU Members Only)
// can see members-only birthdays. Private users and signed-in users without a profile cannot.
const SHARING = '(' + SIGNED + " && (root.child('profiles').child(auth.uid).child('visibility').val() === 'public'" +
  " || root.child('profiles').child(auth.uid).child('visibility').val() === 'members'))";

// ── profiles/$uid ─────────────────────────────────────────────────────
function profilesNode() {
  const NR = 'newData.parent().parent()';
  const idx = function (vis, src) {
    return NR + ".child('bday-" + vis + "').child(" + src + ".child('md').val()).child('u_' + $uid)";
  };
  const PUB = idx('public', 'newData');
  const MEM = idx('members', 'newData');
  const NAME = "newData.child('name').val()";
  const vis = "newData.child('visibility').val()";
  return {
    '.read': ADMIN,
    '$uid': {
      '.read': "(" + SIGNED + " && auth.uid === $uid) || " + ADMIN,
      // Deleting a profile is only allowed once its index rows are gone too.
      '.write': j(
        "((" + SIGNED + " && auth.uid === $uid) || " + ADMIN + ")",
        "&& (newData.exists() || !data.exists() || (!" + idx('public', 'data') + ".exists() && !" + idx('members', 'data') + ".exists()))"
      ),
      '.validate': j(
        "newData.hasChildren(['name','faculty','birthday','md','visibility','createdAt'])",
        "&& newData.child('birthday').val().endsWith('-' + newData.child('md').val())",
        "&& (!data.exists() || data.child('birthday').val() === newData.child('birthday').val() || " + ADMIN + ")",
        "&& ((" + vis + " === 'public' && " + PUB + ".child('n').val() === " + NAME + " && !" + MEM + ".exists())",
        "|| (" + vis + " === 'members' && " + MEM + ".child('n').val() === " + NAME + " && !" + PUB + ".exists())",
        "|| (" + vis + " === 'private' && !" + PUB + ".exists() && !" + MEM + ".exists()))"
      ),
      name: { '.validate': str(2, 60) },
      faculty: { '.validate': str(1, 80) },
      batch: { '.validate': str(1, 20) + " && newData.val().matches(/^[A-Za-z0-9 ._\\/-]+$/)" },
      birthday: { '.validate': 'newData.isString() && newData.val().matches(' + DOB_RE + ')' },
      md: { '.validate': 'newData.isString() && newData.val().matches(' + MD_RE + ')' },
      visibility: { '.validate': "newData.isString() && newData.val().matches(/^(public|members|private)$/)" },
      photo: { '.validate': PHOTO_OK },
      createdAt: { '.validate': 'newData.isNumber() && (' + NOW_ONCE + ')' },
      updatedAt: { '.validate': 'newData.isNumber() && newData.val() === now' },
      $other: { '.validate': false }
    }
  };
}

// ── legacy / guest entries ────────────────────────────────────────────
function birthdayMatesNode() {
  return {
    '.read': ADMIN,
    '$key': {
      '.write': j(
        ADMIN,
        "|| (!data.exists() && newData.exists() && $key.matches(/^-[A-Za-z0-9_-]{19}$/))"
      ),
      '.validate': "newData.hasChildren(['name','faculty','birthday','timestamp'])",
      name: { '.validate': str(2, 60) },
      faculty: { '.validate': str(1, 80) },
      district: { '.validate': str(0, 40) },
      birthday: { '.validate': 'newData.isString() && newData.val().matches(' + DOB_RE + ')' },
      timestamp: { '.validate': str(1, 40) },
      gmail: { '.validate': str(3, 100) },
      claim: { '.validate': str(20, 64) },
      $other: { '.validate': ADMIN }
    }
  };
}

function claimsNode() {
  const NR = 'newData.parent().parent()';
  const P = NR + ".child('profiles').child(auth.uid)";
  const G = NR + ".child('birthday-mates').child($key)";
  return {
    '.read': ADMIN,
    '$key': {
      '.write': j(
        ADMIN,
        "|| (" + SIGNED + " && !data.exists() && newData.exists() && newData.child('uid').val() === auth.uid && " + P + ".exists() && (",
        "(" + G + ".child('claim').exists() && newData.child('token').val() === " + G + ".child('claim').val())",
        // "Is this you?" — the full date of birth (incl. year, never shown to anyone) must match.
        "|| (!" + G + ".child('claim').exists() && " + G + ".child('birthday').val() === " + P + ".child('birthday').val())",
        '))'
      ),
      '.validate': "newData.hasChildren(['uid','at'])",
      uid: { '.validate': str(1, 128) },
      token: { '.validate': str(20, 64) },
      at: { '.validate': 'newData.isNumber() && (' + NOW_ONCE + ')' },
      $other: { '.validate': false }
    }
  };
}

// ── anonymous birthday wishes ─────────────────────────────────────────
function wishesNode() {
  const NR = 'newData.parent().parent().parent()';
  const META = NR + ".child('wish-meta').child($wid)";
  const RP = "root.child('profiles').child($rid)";
  const create = j(
    "(" + SIGNED + " && auth.uid !== $rid && !data.exists() && newData.exists()",
    "&& " + META + ".child('from').val() === auth.uid",
    "&& " + META + ".child('to').val() === $rid",
    "&& " + RP + ".exists() && " + RP + ".child('visibility').val() !== 'private'",
    // give-to-get for wishes too: members-only people can be wished only by people who share theirs
    "&& (" + RP + ".child('visibility').val() === 'public' || root.child('profiles').child(auth.uid).child('visibility').val() === 'public' || root.child('profiles').child(auth.uid).child('visibility').val() === 'members')",
    "&& ((newData.child('anon').val() === true && !newData.child('fromName').exists())",
    "|| (newData.child('anon').val() === false && newData.child('fromName').val() === root.child('profiles').child(auth.uid).child('name').val())))"
  );
  const recipientDelete = "(" + SIGNED + " && auth.uid === $rid && !newData.exists())";
  const recipientOnly = SIGNED + ' && auth.uid === $rid';
  return {
    '.read': ADMIN,
    '$rid': {
      '.read': recipientOnly,
      '$wid': {
        '.write': [ADMIN, recipientDelete, create].join(' || '),
        '.validate': "newData.hasChildren(['msg','anon','at'])",
        msg: {
          '.validate': j(
            str(1, 300),
            '&& newData.val().matches(/[^ \\t\\r\\n]/)',
            '&& !newData.val().matches(/(https?:|www\\.)/i)'
          )
        },
        anon: { '.validate': 'newData.isBoolean()' },
        fromName: { '.validate': str(2, 60) },
        at: { '.validate': 'newData.isNumber() && (' + NOW_ONCE + ')' },
        reported: { '.write': recipientOnly, '.validate': 'newData.val() === true' },
        reportedAt: { '.write': recipientOnly, '.validate': 'newData.isNumber() && newData.val() === now' },
        $other: { '.validate': false }
      }
    }
  };
}

function wishMetaNode() {
  const NR = 'newData.parent().parent()';
  return {
    '.read': ADMIN,
    '$wid': {
      '.write': j(
        ADMIN,
        "|| (" + SIGNED + " && !data.exists() && newData.exists() && newData.child('from').val() === auth.uid",
        "&& " + NR + ".child('wishes').child(newData.child('to').val()).child($wid).exists()",
        "&& " + NR + ".child('wish-rate').child(auth.uid).child('last').val() === now",
        "&& " + NR + ".child('wish-pair').child(auth.uid).child(newData.child('to').val()).val() === now)"
      ),
      '.validate': "newData.hasChildren(['from','to','at'])",
      from: { '.validate': str(1, 128) },
      to: { '.validate': str(1, 128) },
      at: { '.validate': 'newData.isNumber() && (' + NOW_ONCE + ')' },
      removedAt: { '.validate': 'newData.isNumber()' },
      $other: { '.validate': false }
    }
  };
}

function wishRateNode() {
  return {
    '$uid': {
      '.read': SIGNED + ' && auth.uid === $uid',
      '.write': SIGNED + ' && auth.uid === $uid && newData.exists()',
      // >= 30 s between wishes, at most 10 per rolling 24 h window.
      '.validate': j(
        "newData.hasChildren(['last','win','n']) && newData.child('last').val() === now && (",
        "(!data.exists() && newData.child('win').val() === now && newData.child('n').val() === 1)",
        "|| (data.exists() && now - data.child('last').val() >= 30000 && (",
        "(now - data.child('win').val() < 86400000 && newData.child('win').val() === data.child('win').val() && newData.child('n').val() === data.child('n').val() + 1 && newData.child('n').val() <= 10)",
        "|| (now - data.child('win').val() >= 86400000 && newData.child('win').val() === now && newData.child('n').val() === 1))))"
      ),
      last: { '.validate': 'newData.isNumber()' },
      win: { '.validate': 'newData.isNumber()' },
      n: { '.validate': 'newData.isNumber()' },
      $other: { '.validate': false }
    }
  };
}

function wishPairNode() {
  return {
    '$from': {
      '.read': SIGNED + ' && auth.uid === $from',
      '$to': {
        '.write': SIGNED + ' && auth.uid === $from && newData.exists()',
        // one wish per sender -> recipient every 20 h
        '.validate': 'newData.isNumber() && newData.val() === now && (!data.exists() || now - data.val() >= 72000000)'
      }
    }
  };
}

// ── assemble ──────────────────────────────────────────────────────────
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'db-rules.base.json'), 'utf8'));
const rules = base.rules;
rules['birthday-mates'] = birthdayMatesNode();
rules['bday-public'] = indexNode('public', 'true');
rules['bday-members'] = indexNode('members', SHARING);
rules['bday-marks'] = marksNode();
rules['profiles'] = profilesNode();
rules['bday-claims'] = claimsNode();
rules['wishes'] = wishesNode();
rules['wish-meta'] = wishMetaNode();
rules['wish-rate'] = wishRateNode();
rules['wish-pair'] = wishPairNode();
rules['admin-check'] = { '.read': ADMIN };

const out = path.join(__dirname, '..', 'database.rules.json');
fs.writeFileSync(out, JSON.stringify({ rules: rules }, null, 2) + '\n');
console.log('wrote', path.relative(process.cwd(), out));
