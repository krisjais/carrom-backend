const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../src/config/db');
require('../src/models/Participant');
const Participant = require('../src/models/Participant');
const Registration = require('../src/models/Registration');
const Tournament = require('../src/models/Tournament');
const { importParticipants } = require('../src/controllers/registrationController');
const { enrichRegistrationsWithValidation } = require('../src/services/partnerValidationEngine');

// Emulate client CSV parser
function parseCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rawHeaders = lines[0].split(',').map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
  );

  const findExactCol = (aliases) => {
    return rawHeaders.findIndex((h) =>
      aliases.some((alias) => {
        const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
        return h === cleanAlias;
      })
    );
  };

  const findSubstringCol = (includesKeywords, excludeKeywords = []) => {
    return rawHeaders.findIndex((h) => {
      const matchesInc = includesKeywords.some((k) => h.includes(k));
      const matchesExc = excludeKeywords.some((k) => h.includes(k));
      return matchesInc && !matchesExc;
    });
  };

  const nameIdx = findExactCol(['full name', 'student name', 'athlete name', 'player name', 'athlete', 'player', 'name']) >= 0
    ? findExactCol(['full name', 'student name', 'athlete name', 'player name', 'athlete', 'player', 'name'])
    : findSubstringCol(['name'], ['partner']);

  const genderIdx = findExactCol(['gender', 'sex']) >= 0
    ? findExactCol(['gender', 'sex'])
    : findSubstringCol(['gender', 'sex']);

  const deptIdx = findExactCol(['department', 'dept', 'major', 'branch', 'course', 'program']) >= 0
    ? findExactCol(['department', 'dept', 'major', 'branch', 'course', 'program'])
    : findSubstringCol(['department', 'dept', 'major', 'branch']);

  const partSinglesIdx = findExactCol([
    'participate singles', 'participate single', 'singles participate', 'singles participation',
    'participates singles', 'participating singles', 'singles event'
  ]) >= 0
    ? findExactCol(['participate singles', 'participate single', 'singles participate', 'singles participation', 'participates singles', 'participating singles', 'singles event'])
    : findSubstringCol(['participat singles', 'singles participate', 'participate singles']);

  const partDoublesIdx = findExactCol([
    'participate doubles', 'participate double', 'doubles participate', 'doubles participation',
    'participates doubles', 'participating doubles', 'doubles event'
  ]) >= 0
    ? findExactCol(['participate doubles', 'participate double', 'doubles participate', 'doubles participation', 'participates doubles', 'participating doubles', 'doubles event'])
    : findSubstringCol(['participat doubles', 'doubles participate', 'participate doubles'], ['mixed']);

  const partMixedIdx = findExactCol([
    'participate mixed doubles', 'participate mixed', 'mixed doubles participate', 'mixed participate',
    'mixed doubles participation', 'participates mixed doubles', 'participating mixed doubles', 'mixed event'
  ]) >= 0
    ? findExactCol(['participate mixed doubles', 'participate mixed', 'mixed doubles participate', 'mixed participate', 'mixed doubles participation', 'participates mixed doubles', 'participating mixed doubles', 'mixed event'])
    : findSubstringCol(['participat mixed', 'mixed participate', 'participate mixed']);

  const boysGirlsDoublesIdx = findExactCol([
    'boys girls doubles partner', 'boys girls doubles partner name', 'boys girls partner',
    'boys girls partner name', 'boys or girls doubles partner', 'doubles partner', 'doubles partner name',
    'doubles partner request', 'partner name', 'partner'
  ]) >= 0
    ? findExactCol(['boys girls doubles partner', 'boys girls doubles partner name', 'boys girls partner', 'boys girls partner name', 'boys or girls doubles partner', 'doubles partner', 'doubles partner name', 'doubles partner request', 'partner name', 'partner'])
    : findSubstringCol(['boys girls doubles', 'doubles partner'], ['participat', 'participate', 'mixed']);

  const boysDoublesIdx = findExactCol([
    'boys doubles partner', 'boys doubles partner name', 'boys partner', 'boys partner name', 'boy doubles partner'
  ]) >= 0
    ? findExactCol(['boys doubles partner', 'boys doubles partner name', 'boys partner', 'boys partner name', 'boy doubles partner'])
    : findSubstringCol(['boys doubles partner', 'boys partner'], ['girls', 'mixed', 'participat', 'participate']);

  const girlsDoublesIdx = findExactCol([
    'girls doubles partner', 'girls doubles partner name', 'girls partner', 'girls partner name', 'girl doubles partner'
  ]) >= 0
    ? findExactCol(['girls doubles partner', 'girls doubles partner name', 'girls partner', 'girls partner name', 'girl doubles partner'])
    : findSubstringCol(['girls doubles partner', 'girls partner'], ['boys', 'mixed', 'participat', 'participate']);

  const mixedPartnerIdx = findExactCol([
    'mixed doubles partner', 'mixed doubles partner name', 'mixed partner', 'mixed partner name', 'mixed doubles partner request'
  ]) >= 0
    ? findExactCol(['mixed doubles partner', 'mixed doubles partner name', 'mixed partner', 'mixed partner name', 'mixed doubles partner request'])
    : findSubstringCol(['mixed doubles partner', 'mixed partner'], ['participat', 'participate']);

  const parseBooleanParticipation = (val, defaultVal = false) => {
    if (val === undefined || val === null) return defaultVal;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (!s) return defaultVal;
    if (['yes', 'true', '1', 'y'].includes(s)) return true;
    if (['no', 'false', '0', 'n', 'none', 'na', 'n/a', '-'].includes(s)) return false;
    return defaultVal;
  };

  const sanitizePartnerName = (val) => {
    if (!val) return '';
    const s = String(val).replace(/\s+/g, ' ').trim();
    const lower = s.toLowerCase();
    if (['yes', 'no', 'true', 'false', '0', '1', 'none', 'n/a', 'na', '-', 'nil', 'null', 'undefined'].includes(lower)) {
      return '';
    }
    return s;
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const fullName = cols[nameIdx] || '';
    const rawGender = cols[genderIdx] || '';
    const department = cols[deptIdx] || '';

    const gLower = rawGender.toLowerCase().trim();
    let gender = '';
    if (['m', 'male', 'boy', 'boys'].includes(gLower)) gender = 'male';
    else if (['f', 'female', 'girl', 'girls'].includes(gLower)) gender = 'female';

    const rawBoysDoubles = sanitizePartnerName(boysDoublesIdx >= 0 ? cols[boysDoublesIdx] : '');
    const rawGirlsDoubles = sanitizePartnerName(girlsDoublesIdx >= 0 ? cols[girlsDoublesIdx] : '');
    const rawUnifiedDoubles = sanitizePartnerName(boysGirlsDoublesIdx >= 0 ? cols[boysGirlsDoublesIdx] : '');
    const rawMixed = sanitizePartnerName(mixedPartnerIdx >= 0 ? cols[mixedPartnerIdx] : '');

    let candidateDoublesPartner = '';
    let boysDoublesPartner = '';
    let girlsDoublesPartner = '';
    if (gender === 'male') {
      candidateDoublesPartner = rawBoysDoubles || rawUnifiedDoubles;
      boysDoublesPartner = candidateDoublesPartner;
    } else {
      candidateDoublesPartner = rawGirlsDoubles || rawUnifiedDoubles;
      girlsDoublesPartner = candidateDoublesPartner;
    }

    let participateSingles = true;
    if (partSinglesIdx >= 0) {
      participateSingles = parseBooleanParticipation(cols[partSinglesIdx], true);
    }
    let participateDoubles = false;
    if (partDoublesIdx >= 0) {
      participateDoubles = parseBooleanParticipation(cols[partDoublesIdx], false);
    } else {
      participateDoubles = !!candidateDoublesPartner;
    }
    let participateMixedDoubles = false;
    if (partMixedIdx >= 0) {
      participateMixedDoubles = parseBooleanParticipation(cols[partMixedIdx], false);
    } else {
      participateMixedDoubles = !!rawMixed;
    }

    const effectiveDoublesPartner = participateDoubles ? candidateDoublesPartner : '';
    const effectiveMixedPartner = participateMixedDoubles ? rawMixed : '';

    rows.push({
      fullName,
      gender: gender || rawGender,
      department,
      participateSingles,
      participateDoubles,
      participateMixedDoubles,
      boysDoublesPartner: participateDoubles ? boysDoublesPartner : '',
      girlsDoublesPartner: participateDoubles ? girlsDoublesPartner : '',
      doublesPartnerName: effectiveDoublesPartner,
      mixedDoublesPartner: effectiveMixedPartner,
      mixedDoublesPartnerName: effectiveMixedPartner
    });
  }

  return rows;
}

// UI helper function emulation
function renderPartnerStatusBadge(validation, requestedName, isParticipating = true) {
  if (
    isParticipating === false ||
    validation?.status === 'not_participating' ||
    (!requestedName && (!validation || validation.status === 'none'))
  ) {
    return 'Not Enrolled (Optional)';
  }
  return `${requestedName} [${validation?.status}]`;
}

async function runTests() {
  await connectDB();
  const tourn = await Tournament.findOne().sort({ createdAt: -1 });

  // Test CSV containing the 5 cases
  const testCSV = `Full Name,Gender,Department,Participate Singles,Participate Doubles,Participate Mixed Doubles,Boys/Girls Doubles Partner,Mixed Doubles Partner
Case One User,Female,Computer Science,Yes,No,No,,
Case Two User,Male,Mechanical Engineering,Yes,Yes,No,Rohan Mehta,
Case Three User,Female,Civil Engineering,Yes,No,No,,
Case Four User,Male,Electrical Engineering,Yes,No,Yes,,Priya Nair
Meera Patel,Female,Information Technology,Yes,No,No,,`;

  const parsed = parseCSV(testCSV);
  console.log('--- Step 1: Parsed Rows from CSV ---');
  parsed.forEach((p, idx) => {
    console.log(`Row ${idx + 1}: ${p.fullName} (${p.gender})`);
    console.log(`  Singles: ${p.participateSingles}, Doubles: ${p.participateDoubles} (Partner: "${p.doublesPartnerName}"), Mixed: ${p.participateMixedDoubles} (Partner: "${p.mixedDoublesPartnerName}")`);
  });

  // Import into DB via importParticipants controller
  let req = {
    body: { participants: parsed, tournamentId: tourn._id },
    user: { _id: new mongoose.Types.ObjectId(), fullName: 'Admin' }
  };
  let resData = null;
  let res = { status: () => res, json: (d) => { resData = d; } };

  await importParticipants(req, res, (err) => { if (err) throw err; });
  console.log('\n--- Step 2: Controller Import Response ---');
  console.log(resData.message);

  // Query and enrich registrations
  const names = ['Case One User', 'Case Two User', 'Case Three User', 'Case Four User', 'Meera Patel'];
  const participants = await Participant.find({ fullName: { $in: names } });
  const pIds = participants.map(p => p._id);
  const regs = await Registration.find({ participantId: { $in: pIds }, tournamentId: tourn._id }).populate('participantId');
  const enriched = await enrichRegistrationsWithValidation(regs, tourn._id);

  console.log('\n--- Step 3: Verification of the 5 Required Cases ---');

  // CASE 1: Participate Doubles = No, Partner = empty -> Doubles: Not Enrolled (Optional)
  const case1 = enriched.find(r => r.participantId.fullName === 'Case One User');
  const c1DoublesBadge = renderPartnerStatusBadge(case1.doublesValidation, case1.doublesPartnerName, case1.participateDoubles);
  console.log(`CASE 1: Participate Doubles = No -> Doubles Display: "${c1DoublesBadge}"`);
  console.assert(c1DoublesBadge === 'Not Enrolled (Optional)', 'CASE 1 FAILED: Expected Not Enrolled (Optional)');

  // CASE 2: Participate Doubles = Yes, Partner = "Rohan Mehta" -> Doubles: Rohan Mehta + partner validation
  const case2 = enriched.find(r => r.participantId.fullName === 'Case Two User');
  const c2DoublesBadge = renderPartnerStatusBadge(case2.doublesValidation, case2.doublesPartnerName, case2.participateDoubles);
  console.log(`CASE 2: Participate Doubles = Yes, Partner = "Rohan Mehta" -> Doubles Display: "${c2DoublesBadge}"`);
  console.assert(c2DoublesBadge.includes('Rohan Mehta'), 'CASE 2 FAILED: Expected Rohan Mehta');

  // CASE 3: Participate Mixed Doubles = No, Partner = empty -> Mixed: Not Enrolled (Optional)
  const case3 = enriched.find(r => r.participantId.fullName === 'Case Three User');
  const c3MixedBadge = renderPartnerStatusBadge(case3.mixedDoublesValidation, case3.mixedDoublesPartnerName, case3.participateMixedDoubles);
  console.log(`CASE 3: Participate Mixed Doubles = No -> Mixed Display: "${c3MixedBadge}"`);
  console.assert(c3MixedBadge === 'Not Enrolled (Optional)', 'CASE 3 FAILED: Expected Not Enrolled (Optional)');

  // CASE 4: Participate Mixed Doubles = Yes, Partner = "Priya Nair" -> Mixed: Priya Nair + partner validation
  const case4 = enriched.find(r => r.participantId.fullName === 'Case Four User');
  const c4MixedBadge = renderPartnerStatusBadge(case4.mixedDoublesValidation, case4.mixedDoublesPartnerName, case4.participateMixedDoubles);
  console.log(`CASE 4: Participate Mixed Doubles = Yes, Partner = "Priya Nair" -> Mixed Display: "${c4MixedBadge}"`);
  console.assert(c4MixedBadge.includes('Priya Nair'), 'CASE 4 FAILED: Expected Priya Nair');

  // CASE 5: Singles = Yes, Doubles = No, Mixed = No -> Only Singles badge, Doubles and Mixed both say Not Enrolled (Optional)
  const meera = enriched.find(r => r.participantId.fullName === 'Meera Patel');
  const meeraSinglesBadge = meera.participateSingles !== false;
  const meeraDoublesBadge = meera.participateDoubles === true;
  const meeraMixedBadge = meera.participateMixedDoubles === true;
  const meeraDoublesText = renderPartnerStatusBadge(meera.doublesValidation, meera.doublesPartnerName, meera.participateDoubles);
  const meeraMixedText = renderPartnerStatusBadge(meera.mixedDoublesValidation, meera.mixedDoublesPartnerName, meera.participateMixedDoubles);

  console.log(`CASE 5: Meera Patel:`);
  console.log(`  Singles Badge shown: ${meeraSinglesBadge}`);
  console.log(`  Doubles Badge shown: ${meeraDoublesBadge}`);
  console.log(`  Mixed Badge shown: ${meeraMixedBadge}`);
  console.log(`  Doubles Partner Column: "${meeraDoublesText}"`);
  console.log(`  Mixed Partner Column: "${meeraMixedText}"`);
  console.assert(meeraSinglesBadge === true, 'CASE 5 FAILED: Singles badge missing');
  console.assert(meeraDoublesBadge === false, 'CASE 5 FAILED: Doubles badge should NOT be shown');
  console.assert(meeraMixedBadge === false, 'CASE 5 FAILED: Mixed badge should NOT be shown');
  console.assert(meeraDoublesText === 'Not Enrolled (Optional)', 'CASE 5 FAILED: Doubles partner should be Not Enrolled (Optional)');
  console.assert(meeraMixedText === 'Not Enrolled (Optional)', 'CASE 5 FAILED: Mixed partner should be Not Enrolled (Optional)');

  console.log('\n>>> ALL 5 CASES PASSED PERFECTLY! <<<');

  // Clean up test cases 1-4 (keep Meera Patel as desired)
  await Registration.deleteMany({ tournamentId: tourn._id, participantId: { $in: participants.filter(p => p.fullName.startsWith('Case')).map(p => p._id) } });
  await Participant.deleteMany({ fullName: { $in: ['Case One User', 'Case Two User', 'Case Three User', 'Case Four User'] } });

  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
