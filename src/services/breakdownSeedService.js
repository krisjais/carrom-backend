const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Participant = require('../models/Participant');
const Tournament = require('../models/Tournament');
const Registration = require('../models/Registration');
const Team = require('../models/Team');
const Match = require('../models/Match');
const Announcement = require('../models/Announcement');
const AuditLog = require('../models/AuditLog');

const PARTICIPANTS_DATA = [
  { no: 1, fullName: 'Abdulla Shaikh', gender: 'male', department: 'IT', phone: '8454097769', participateSingles: true, participateDoubles: false, participateMixedDoubles: false, doublesPartnerName: '', mixedDoublesPartnerName: '' },
  { no: 2, fullName: 'Affan Khan', gender: 'male', department: 'BVOC 2nd Year', phone: '7208949865', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Sami', mixedDoublesPartnerName: 'Roheen ansari' },
  { no: 3, fullName: 'Sufiyan Khan', gender: 'male', department: 'Marketing Junction', phone: '7303472899', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Tushar', mixedDoublesPartnerName: 'Tasmiya' },
  { no: 4, fullName: 'Junaid Khan', gender: 'male', department: 'BVOC 1st Year', phone: '9702031327', participateSingles: false, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Ikrama Ghavte', mixedDoublesPartnerName: '' },
  { no: 5, fullName: 'Farhan Tolkar', gender: 'male', department: 'BVOC 2nd Year', phone: '8010491875', participateSingles: true, participateDoubles: false, participateMixedDoubles: false, doublesPartnerName: '', mixedDoublesPartnerName: '' },
  { no: 6, fullName: 'Faraz Khan', gender: 'male', department: 'BVOC 1st Year', phone: '9321130694', participateSingles: true, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Ahmed Siddique', mixedDoublesPartnerName: '' },
  { no: 7, fullName: 'Mirza beg', gender: 'male', department: 'BVOC 1st Year', phone: '8948503809', participateSingles: true, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Mohammed ayan', mixedDoublesPartnerName: '' },
  { no: 8, fullName: 'Mohammed Qutbuddin Kotkunde', gender: 'male', department: 'NIT', phone: '8104201996', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Any', mixedDoublesPartnerName: 'Any' },
  { no: 9, fullName: 'Shamshad Khan', gender: 'male', department: 'IT', phone: '7045421273', participateSingles: false, participateDoubles: false, participateMixedDoubles: true, doublesPartnerName: '', mixedDoublesPartnerName: 'Ma' },
  { no: 10, fullName: 'Sameer Bhosale', gender: 'male', department: 'IT', phone: '9137326904', participateSingles: true, participateDoubles: false, participateMixedDoubles: false, doublesPartnerName: '', mixedDoublesPartnerName: '' },
  { no: 11, fullName: 'Mohammed Jagda', gender: 'male', department: 'IT', phone: '7700072367', participateSingles: false, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Zaid Acchwa', mixedDoublesPartnerName: '' },
  { no: 12, fullName: 'Viraj Adsul', gender: 'male', department: 'IT', phone: '932767931', participateSingles: false, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Mudassir markania', mixedDoublesPartnerName: '' },
  { no: 13, fullName: 'Mohammed Ayan Sayed', gender: 'male', department: 'BVOC 1st Year', phone: '8879398010', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Ubaid', mixedDoublesPartnerName: 'Alijah Malik' },
  { no: 14, fullName: 'Pravin Chettiar', gender: 'male', department: 'BVOC 2nd Year', phone: '8850935147', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Sanskar ashan', mixedDoublesPartnerName: 'Anam Choudhary' },
  { no: 15, fullName: 'Saeed Siddiqui Siddiqui', gender: 'male', department: 'NIT', phone: '9967665484', participateSingles: true, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Shamsh Ali', mixedDoublesPartnerName: '' },
  { no: 16, fullName: 'Mariya Shaikh', gender: 'female', department: 'Ex Intern', phone: '7400435854', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Aliza', mixedDoublesPartnerName: 'Nouman' },
  { no: 17, fullName: 'Faraaz Kurawle', gender: 'male', department: 'IT', phone: '9930961075', participateSingles: true, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Abdullah Shaikh', mixedDoublesPartnerName: '' },
  { no: 18, fullName: 'Anam Choudhary', gender: 'female', department: 'BVOC 1st Year', phone: '9987231823', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Ifra malik', mixedDoublesPartnerName: 'Pravin' },
  { no: 19, fullName: 'Piyush Pandey', gender: 'male', department: 'IT', phone: '7304192249', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Awwab sondey', mixedDoublesPartnerName: 'Siddhi ghanekar' },
  { no: 20, fullName: 'Ikrama Ghavte', gender: 'male', department: 'BVOC 1st Year', phone: '7045236487', participateSingles: false, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Junaid Khan', mixedDoublesPartnerName: '' },
  { no: 21, fullName: 'Ali Mapari', gender: 'male', department: 'BVOC 1st Year', phone: '7506565137', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Qutbuddin kotkunde', mixedDoublesPartnerName: 'Shweta kedare' },
  { no: 22, fullName: 'Sami Shaikh', gender: 'male', department: 'BVOC 1st Year', phone: '9321490627', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Vishwajeet', mixedDoublesPartnerName: '' },
  { no: 23, fullName: 'Nouman Khan', gender: 'male', department: 'IT', phone: '8097120326', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Aquib Hingwala', mixedDoublesPartnerName: 'Mariya' },
  { no: 24, fullName: 'Tushar Sutar', gender: 'male', department: 'BVOC 1st Year', phone: '9867652665', participateSingles: true, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Sufiyan Khan', mixedDoublesPartnerName: '' },
  { no: 25, fullName: 'Abdul Ahad Khan', gender: 'male', department: 'Ex Intern', phone: '9867607406', participateSingles: false, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Akshat Gupta', mixedDoublesPartnerName: '' },
  { no: 26, fullName: 'Siddhi Ghanekar', gender: 'female', department: 'HR', phone: '8104360693', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Shweta Kedare', mixedDoublesPartnerName: 'PiyushPandey!' },
  { no: 27, fullName: 'Anjali Yadav', gender: 'female', department: 'HR', phone: '9152560533', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Kainat', mixedDoublesPartnerName: 'Aquib hingwala' },
  { no: 28, fullName: 'Aquib Hingwala', gender: 'male', department: 'Ex Intern', phone: '9167838311', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Nouman Khan', mixedDoublesPartnerName: 'Anjali HR' },
  { no: 29, fullName: 'Roheen Ansari', gender: 'female', department: 'BVOC 1st Year', phone: '9321180800', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'No one', mixedDoublesPartnerName: 'Affan' },
  { no: 30, fullName: 'Irfan Shaikh', gender: 'male', department: 'BVOC 2nd Year', phone: '7715053367', participateSingles: true, participateDoubles: false, participateMixedDoubles: false, doublesPartnerName: '', mixedDoublesPartnerName: '' },
  { no: 31, fullName: 'Sanskar Ashan', gender: 'male', department: 'BVOC 2nd Year', phone: '9082903203', participateSingles: true, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'PRAVIN CHETTIAR', mixedDoublesPartnerName: '' },
  { no: 32, fullName: 'Kainat Khan', gender: 'female', department: 'BVOC 1st Year', phone: '9920839304', participateSingles: true, participateDoubles: false, participateMixedDoubles: false, doublesPartnerName: '', mixedDoublesPartnerName: '' },
  { no: 33, fullName: 'Abhijeet Sawant', gender: 'male', department: 'Ex Intern', phone: '9867644289', participateSingles: true, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Vinayak Gupta', mixedDoublesPartnerName: '' },
  { no: 34, fullName: 'Devinshree Marathe', gender: 'female', department: 'NIT', phone: '8591075509', participateSingles: false, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Sanchita Dalvi', mixedDoublesPartnerName: 'Vinayak' },
  { no: 35, fullName: 'Amit Kanojiya', gender: 'male', department: 'Ex Intern', phone: '7021612314', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Chinmay', mixedDoublesPartnerName: 'Sanchita Dalvi' },
  { no: 36, fullName: 'Sanchita Dalvi', gender: 'female', department: 'NIT', phone: '9021843642', participateSingles: false, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Devinshree Marathe', mixedDoublesPartnerName: 'Amit kanojiya' },
  { no: 37, fullName: 'Vinayak Gupta', gender: 'male', department: 'IT', phone: '9167140832', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Abhijeet Sawant', mixedDoublesPartnerName: 'Devinshree' },
  { no: 38, fullName: 'Prashant Patil', gender: 'male', department: 'IT', phone: '9594430295', participateSingles: false, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Saeed', mixedDoublesPartnerName: '' },
  { no: 39, fullName: 'Ammar Juwle', gender: 'male', department: 'BVOC 1st Year', phone: '9220061501', participateSingles: false, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Abdurehman', mixedDoublesPartnerName: '' },
  { no: 40, fullName: 'Awwab Sonday', gender: 'male', department: 'IT', phone: '7620661529', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Piyush Pandey', mixedDoublesPartnerName: 'Anjali Yadav' },
  { no: 41, fullName: 'Piyush Patwa', gender: 'male', department: 'BVOC 2nd Year', phone: '9619825701', participateSingles: true, participateDoubles: false, participateMixedDoubles: false, doublesPartnerName: '', mixedDoublesPartnerName: '' },
  { no: 42, fullName: 'Nafisa Khan', gender: 'female', department: 'BVOC 2nd Year', phone: '7506996943', participateSingles: true, participateDoubles: false, participateMixedDoubles: false, doublesPartnerName: '', mixedDoublesPartnerName: '' },
  { no: 43, fullName: 'Saad ranasaria', gender: 'male', department: 'BVOC 1st Year', phone: '9867402997', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Sabir', mixedDoublesPartnerName: 'Alisha' },
  { no: 44, fullName: 'Alijah Malik', gender: 'female', department: 'BVOC 1st Year', phone: '9555102845', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Mariya Mam', mixedDoublesPartnerName: 'Ayaan' },
  { no: 45, fullName: 'Awab Fakih', gender: 'male', department: 'NIT', phone: '8976104646', participateSingles: true, participateDoubles: true, participateMixedDoubles: false, doublesPartnerName: 'Quitbuddin', mixedDoublesPartnerName: '' },
  { no: 46, fullName: 'Aaliya Golandaz', gender: 'female', department: 'HR', phone: '8652064336', participateSingles: false, participateDoubles: false, participateMixedDoubles: true, doublesPartnerName: '', mixedDoublesPartnerName: 'Sami shaikh' },
  { no: 47, fullName: 'Tamanna Ansari', gender: 'female', department: 'BVOC 2nd Year', phone: '8700953211', participateSingles: true, participateDoubles: true, participateMixedDoubles: true, doublesPartnerName: 'Anam', mixedDoublesPartnerName: 'Mudassir' }
];

const MUTUAL_BOYS_DOUBLES_PAIRS = [
  ['Sufiyan Khan', 'Tushar Sutar'],
  ['Junaid Khan', 'Ikrama Ghavte'],
  ['Pravin Chettiar', 'Sanskar Ashan'],
  ['Piyush Pandey', 'Awwab Sonday'],
  ['Nouman Khan', 'Aquib Hingwala'],
  ['Abhijeet Sawant', 'Vinayak Gupta']
];

const MUTUAL_GIRLS_DOUBLES_PAIRS = [
  ['Mariya Shaikh', 'Alijah Malik'],
  ['Devinshree Marathe', 'Sanchita Dalvi']
];

const MUTUAL_MIXED_DOUBLES_PAIRS = [
  ['Affan Khan', 'Roheen Ansari'],
  ['Mohammed Ayan Sayed', 'Alijah Malik'],
  ['Pravin Chettiar', 'Anam Choudhary'],
  ['Piyush Pandey', 'Siddhi Ghanekar'],
  ['Nouman Khan', 'Mariya Shaikh'],
  ['Aquib Hingwala', 'Anjali Yadav'],
  ['Amit Kanojiya', 'Sanchita Dalvi'],
  ['Vinayak Gupta', 'Devinshree Marathe']
];

/**
 * Clears Carrom tournament collections (preserving Admin user and Chess collections)
 * and bulk-seeds the 47 participants, registrations, and approved teams from
 * Carrom_Gender_Format_Breakdown.md.
 */
const seedBreakdownData = async (actor = null) => {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@carrom.edu').toLowerCase().trim();

  await Promise.all([
    User.deleteMany({ email: { $ne: adminEmail }, role: 'participant' }),
    Participant.deleteMany({}),
    Registration.deleteMany({}),
    Team.deleteMany({}),
    Match.deleteMany({}),
    Announcement.deleteMany({})
  ]);

  let tournament = await Tournament.findOne().sort({ createdAt: -1 });
  if (!tournament) {
    tournament = await Tournament.create({
      title: 'Annual Intra-College Carrom Championship',
      edition: '2026',
      status: 'registration_open',
      scheduleSettings: {
        startTime: new Date(),
        matchDurationMinutes: 20,
        roundDurationMinutes: 20,
        breakTimeMinutes: 5,
        minRestTimeMinutes: 0
      },
      drawsPublished: {
        boys_singles: false,
        girls_singles: false,
        boys_doubles: false,
        girls_doubles: false,
        mixed_doubles: false
      },
      drawsLocked: {
        boys_singles: false,
        girls_singles: false,
        boys_doubles: false,
        girls_doubles: false,
        mixed_doubles: false
      }
    });
  } else {
    tournament.drawsPublished = {
      boys_singles: false,
      girls_singles: false,
      boys_doubles: false,
      girls_doubles: false,
      mixed_doubles: false
    };
    tournament.drawsLocked = {
      boys_singles: false,
      girls_singles: false,
      boys_doubles: false,
      girls_doubles: false,
      mixed_doubles: false
    };
    tournament.markModified('drawsPublished');
    tournament.markModified('drawsLocked');
    await tournament.save();
  }

  const usedSlugs = new Set();
  const buildSlug = (fullName) => {
    const base = String(fullName || 'player')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    let slug = base || 'player';
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}${suffix}`;
      suffix++;
    }
    usedSlugs.add(slug);
    return slug;
  };

  const enrichedEntries = PARTICIPANTS_DATA.map((entry) => {
    const slug = buildSlug(entry.fullName);
    return {
      ...entry,
      username: slug,
      email: `${slug}@carrom.edu`
    };
  });

  const insertedParticipants = await Participant.insertMany(
    enrichedEntries.map((entry) => ({
      fullName: entry.fullName,
      gender: entry.gender,
      studentId: '',
      department: entry.department,
      email: entry.email,
      phone: entry.phone,
      isApproved: true
    }))
  );

  const participantMap = new Map();
  insertedParticipants.forEach((doc) => {
    participantMap.set(doc.fullName, doc);
  });

  // Provision participant login User accounts (default password = registered WhatsApp phone)
  const userDocs = await Promise.all(
    enrichedEntries.map(async (entry) => {
      const p = participantMap.get(entry.fullName);
      const hashedPassword = await bcrypt.hash(entry.phone || 'carrom2026', 8);
      return {
        username: entry.username,
        email: entry.email,
        password: hashedPassword,
        role: 'participant',
        fullName: entry.fullName,
        participantRef: p._id
      };
    })
  );
  const insertedUsers = await User.insertMany(userDocs);
  await Participant.bulkWrite(
    insertedUsers.map((u) => ({
      updateOne: {
        filter: { _id: u.participantRef },
        update: { $set: { userId: u._id } }
      }
    }))
  );

  // Map verified mutual partner IDs so registrations link directly to canonical Participant _id
  const mutualDoublesIdMap = new Map();
  for (const [n1, n2] of [...MUTUAL_BOYS_DOUBLES_PAIRS, ...MUTUAL_GIRLS_DOUBLES_PAIRS]) {
    const p1 = participantMap.get(n1);
    const p2 = participantMap.get(n2);
    if (p1 && p2) {
      mutualDoublesIdMap.set(n1, p2._id);
      mutualDoublesIdMap.set(n2, p1._id);
    }
  }
  const mutualMixedIdMap = new Map();
  for (const [n1, n2] of MUTUAL_MIXED_DOUBLES_PAIRS) {
    const p1 = participantMap.get(n1);
    const p2 = participantMap.get(n2);
    if (p1 && p2) {
      mutualMixedIdMap.set(n1, p2._id);
      mutualMixedIdMap.set(n2, p1._id);
    }
  }

  await Registration.insertMany(
    PARTICIPANTS_DATA.map((entry) => ({
      participantId: participantMap.get(entry.fullName)._id,
      tournamentId: tournament._id,
      gender: entry.gender,
      participateSingles: entry.participateSingles,
      participateDoubles: entry.participateDoubles,
      participateMixedDoubles: entry.participateMixedDoubles,
      doublesPartnerName: entry.doublesPartnerName,
      doublesPartnerId: mutualDoublesIdMap.get(entry.fullName) || null,
      mixedDoublesPartnerName: entry.mixedDoublesPartnerName,
      mixedDoublesPartnerId: mutualMixedIdMap.get(entry.fullName) || null,
      status: 'approved'
    }))
  );

  const teamDocs = [];
  let boysSinglesCount = 0;
  let girlsSinglesCount = 0;

  for (const entry of PARTICIPANTS_DATA) {
    if (!entry.participateSingles) continue;
    const p = participantMap.get(entry.fullName);
    const category = entry.gender === 'male' ? 'boys_singles' : 'girls_singles';
    teamDocs.push({
      name: p.fullName,
      tournamentId: tournament._id,
      category,
      player1: p._id,
      player2: null,
      isApproved: true
    });
    if (category === 'boys_singles') boysSinglesCount++;
    else girlsSinglesCount++;
  }

  const pushMutualPairs = (pairs, category) => {
    for (const [name1, name2] of pairs) {
      const p1 = participantMap.get(name1);
      const p2 = participantMap.get(name2);
      if (!p1 || !p2) {
        throw new Error(`Missing participant for ${category} pair: ${name1} & ${name2}`);
      }
      teamDocs.push({
        name: `${p1.fullName} & ${p2.fullName}`,
        tournamentId: tournament._id,
        category,
        player1: p1._id,
        player2: p2._id,
        isApproved: true
      });
    }
    return pairs.length;
  };

  const boysDoublesCount = pushMutualPairs(MUTUAL_BOYS_DOUBLES_PAIRS, 'boys_doubles');
  const girlsDoublesCount = pushMutualPairs(MUTUAL_GIRLS_DOUBLES_PAIRS, 'girls_doubles');
  const mixedDoublesCount = pushMutualPairs(MUTUAL_MIXED_DOUBLES_PAIRS, 'mixed_doubles');

  await Team.insertMany(teamDocs);

  if (actor && actor._id) {
    await AuditLog.create({
      action: 'SEED_BREAKDOWN_DATA',
      performedBy: actor._id,
      performedByName: actor.fullName || 'Admin',
      entityType: 'Tournament',
      entityId: tournament._id.toString(),
      details: {
        participants: insertedParticipants.length,
        teams: teamDocs.length
      },
      reason: 'Seeded 47 participants and format breakdown registrations/teams.'
    });
  }

  const maleParticipants = PARTICIPANTS_DATA.filter((p) => p.gender === 'male').length;
  const femaleParticipants = PARTICIPANTS_DATA.filter((p) => p.gender === 'female').length;
  const singlesMale = PARTICIPANTS_DATA.filter((p) => p.gender === 'male' && p.participateSingles).length;
  const singlesFemale = PARTICIPANTS_DATA.filter((p) => p.gender === 'female' && p.participateSingles).length;
  const doublesMale = PARTICIPANTS_DATA.filter((p) => p.gender === 'male' && p.participateDoubles).length;
  const doublesFemale = PARTICIPANTS_DATA.filter((p) => p.gender === 'female' && p.participateDoubles).length;
  const mixedMale = PARTICIPANTS_DATA.filter((p) => p.gender === 'male' && p.participateMixedDoubles).length;
  const mixedFemale = PARTICIPANTS_DATA.filter((p) => p.gender === 'female' && p.participateMixedDoubles).length;

  return {
    tournamentId: tournament._id,
    uniqueParticipants: { male: maleParticipants, female: femaleParticipants, total: insertedParticipants.length },
    formats: {
      singles: { male: singlesMale, female: singlesFemale, total: singlesMale + singlesFemale },
      doubles: { male: doublesMale, female: doublesFemale, total: doublesMale + doublesFemale },
      mixedDoubles: { male: mixedMale, female: mixedFemale, total: mixedMale + mixedFemale }
    },
    teams: {
      boys_singles: boysSinglesCount,
      girls_singles: girlsSinglesCount,
      boys_doubles: boysDoublesCount,
      girls_doubles: girlsDoublesCount,
      mixed_doubles: mixedDoublesCount,
      total: teamDocs.length
    }
  };
};

module.exports = {
  PARTICIPANTS_DATA,
  seedBreakdownData
};
