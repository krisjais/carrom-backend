require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Participant = require('../models/Participant');
const Tournament = require('../models/Tournament');
const Registration = require('../models/Registration');
const Team = require('../models/Team');
const Match = require('../models/Match');
const Announcement = require('../models/Announcement');
const AuditLog = require('../models/AuditLog');
const { generateDynamicBracket } = require('../services/drawEngine');

const seedDatabase = async () => {
  try {
    await connectDB();
    console.log('[Seed] Connected to database. Clearing old data...');

    await Promise.all([
      User.deleteMany({}),
      Participant.deleteMany({}),
      Tournament.deleteMany({}),
      Registration.deleteMany({}),
      Team.deleteMany({}),
      Match.deleteMany({}),
      Announcement.deleteMany({}),
      AuditLog.deleteMany({})
    ]);

    console.log('[Seed] Old collections cleared.');

    // 1. Create Admin User
    const adminUser = await User.create({
      username: 'admin',
      email: process.env.ADMIN_EMAIL || 'admin@carrom.edu',
      password: process.env.ADMIN_PASSWORD || 'admincarrom2026',
      role: 'admin',
      fullName: 'Tournament Director'
    });
    console.log(`[Seed] Created Admin: ${adminUser.email}`);

    // 2. Create Active Tournament
    const tournament = await Tournament.create({
      title: 'Annual Inter-College Carrom Championship',
      edition: '2026',
      status: 'ongoing',
      scheduleSettings: {
        startTime: new Date(),
        matchDurationMinutes: 30,
        breakTimeMinutes: 5,
        minRestTimeMinutes: 10
      },
      rulesContent: `### Tournament Rules

1. **Match Format**: All matches are played as **Best of 3 Boards**. The first player/team to win **2 boards** wins the match (2–0 or 2–1). Board 3 is played strictly if the first two boards result in 1–1.
2. **Point Scoring**:
   - Each white/black coin pocketed = **1 point**.
   - Queen pocketed = **3 points** ONLY when properly covered with another coin in the immediate shot.
   - Pocketing striker / foul penalty = **-1 point** and the turn ends.
   - Maximum achievable score for any single board = **25 points**.
3. **Board Confirmation**: Because the physical Carrom match takes place on physical Carrom boards, the tournament Admin enters the board points, Queen, and fouls, and manually selects and confirms the winner of each board.
4. **Advancement**: Once the match winner is confirmed, the winner automatically advances to the next round in the dynamic knockout bracket.
5. **Draws and Byes**: Brackets are dynamically generated for any arbitrary participant count. Byes are randomly placed and automatically advance into their linked next-round slots.
6. **Code of Conduct**: Players must report to their assigned Carrom board within 10 minutes of schedule announcement.`,
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

    // 3. Create Sample Participants
    const maleData = [
      { fullName: 'Aryan Sharma', studentId: 'CS202601', email: 'aryan@carrom.edu', phone: '9876543210', dept: 'Computer Science', dPartner: 'Rohan Gupta', mPartner: 'Ananya Verma' },
      { fullName: 'Rohan Gupta', studentId: 'CS202602', email: 'rohan@carrom.edu', phone: '9876543211', dept: 'Computer Science', dPartner: 'Aryan Sharma', mPartner: 'Pooja Nair' },
      { fullName: 'Devansh Verma', studentId: 'ME202603', email: 'devansh@carrom.edu', phone: '9876543212', dept: 'Mechanical Engg', dPartner: 'Kabir Mehta', mPartner: 'Sneha Patel' },
      { fullName: 'Kabir Mehta', studentId: 'ME202604', email: 'kabir@carrom.edu', phone: '9876543213', dept: 'Mechanical Engg', dPartner: 'Devansh Verma', mPartner: 'Rhea Sen' },
      { fullName: 'Siddharth Rao', studentId: 'EE202605', email: 'siddharth@carrom.edu', phone: '9876543214', dept: 'Electrical Engg', dPartner: 'Aditya Joshi', mPartner: 'Meera Iyer' },
      { fullName: 'Aditya Joshi', studentId: 'EE202606', email: 'aditya@carrom.edu', phone: '9876543215', dept: 'Electrical Engg', dPartner: 'Siddharth Rao', mPartner: 'Tanvi Shah' },
      { fullName: 'Vikram Singh', studentId: 'EC202607', email: 'vikram@carrom.edu', phone: '9876543216', dept: 'Electronics', dPartner: 'Yash Vardhan', mPartner: 'Divya Reddy' },
      { fullName: 'Yash Vardhan', studentId: 'EC202608', email: 'yash@carrom.edu', phone: '9876543217', dept: 'Electronics', dPartner: 'Vikram Singh', mPartner: 'Kavya Pillai' },
      { fullName: 'Nikhil Saxena', studentId: 'CV202609', email: 'nikhil@carrom.edu', phone: '9876543218', dept: 'Civil Engg', dPartner: 'Manish Rawat', mPartner: 'Isha Deshmukh' },
      { fullName: 'Manish Rawat', studentId: 'CV202610', email: 'manish@carrom.edu', phone: '9876543219', dept: 'Civil Engg', dPartner: 'Nikhil Saxena', mPartner: 'Prisha Kapoor' }
    ];

    const femaleData = [
      { fullName: 'Ananya Verma', studentId: 'CS202611', email: 'ananya@carrom.edu', phone: '9876543220', dept: 'Computer Science', dPartner: 'Pooja Nair', mPartner: 'Aryan Sharma' },
      { fullName: 'Pooja Nair', studentId: 'CS202612', email: 'pooja@carrom.edu', phone: '9876543221', dept: 'Computer Science', dPartner: 'Ananya Verma', mPartner: 'Rohan Gupta' },
      { fullName: 'Sneha Patel', studentId: 'IT202613', email: 'sneha@carrom.edu', phone: '9876543222', dept: 'Information Tech', dPartner: 'Rhea Sen', mPartner: 'Devansh Verma' },
      { fullName: 'Rhea Sen', studentId: 'IT202614', email: 'rhea@carrom.edu', phone: '9876543223', dept: 'Information Tech', dPartner: 'Sneha Patel', mPartner: 'Kabir Mehta' },
      { fullName: 'Meera Iyer', studentId: 'BT202615', email: 'meera@carrom.edu', phone: '9876543224', dept: 'Biotech', dPartner: 'Tanvi Shah', mPartner: 'Siddharth Rao' },
      { fullName: 'Tanvi Shah', studentId: 'BT202616', email: 'tanvi@carrom.edu', phone: '9876543225', dept: 'Biotech', dPartner: 'Meera Iyer', mPartner: 'Aditya Joshi' },
      { fullName: 'Divya Reddy', studentId: 'CH202617', email: 'divya@carrom.edu', phone: '9876543226', dept: 'Chemical Engg', dPartner: 'Kavya Pillai', mPartner: 'Vikram Singh' },
      { fullName: 'Kavya Pillai', studentId: 'CH202618', email: 'kavya@carrom.edu', phone: '9876543227', dept: 'Chemical Engg', dPartner: 'Divya Reddy', mPartner: 'Yash Vardhan' }
    ];

    const maleParticipants = [];
    for (const m of maleData) {
      const p = await Participant.create({
        fullName: m.fullName,
        gender: 'male',
        studentId: m.studentId,
        email: m.email,
        phone: m.phone,
        department: m.dept,
        isApproved: true
      });

      const user = await User.create({
        username: m.email.split('@')[0],
        email: m.email,
        password: 'password123',
        role: 'participant',
        fullName: m.fullName,
        participantRef: p._id
      });
      p.userId = user._id;
      await p.save();

      await Registration.create({
        participantId: p._id,
        tournamentId: tournament._id,
        gender: 'male',
        doublesPartnerName: m.dPartner,
        mixedDoublesPartnerName: m.mPartner,
        status: 'approved'
      });

      maleParticipants.push(p);
    }

    const femaleParticipants = [];
    for (const f of femaleData) {
      const p = await Participant.create({
        fullName: f.fullName,
        gender: 'female',
        studentId: f.studentId,
        email: f.email,
        phone: f.phone,
        department: f.dept,
        isApproved: true
      });

      const user = await User.create({
        username: f.email.split('@')[0],
        email: f.email,
        password: 'password123',
        role: 'participant',
        fullName: f.fullName,
        participantRef: p._id
      });
      p.userId = user._id;
      await p.save();

      await Registration.create({
        participantId: p._id,
        tournamentId: tournament._id,
        gender: 'female',
        doublesPartnerName: f.dPartner,
        mixedDoublesPartnerName: f.mPartner,
        status: 'approved'
      });

      femaleParticipants.push(p);
    }

    console.log(`[Seed] Created ${maleParticipants.length} male and ${femaleParticipants.length} female participants.`);

    // 4. Create Category Teams
    // Boys Singles (10 teams)
    for (const p of maleParticipants) {
      await Team.create({
        name: p.fullName,
        tournamentId: tournament._id,
        category: 'boys_singles',
        player1: p._id,
        player2: null,
        isApproved: true
      });
    }

    // Girls Singles (8 teams)
    for (const p of femaleParticipants) {
      await Team.create({
        name: p.fullName,
        tournamentId: tournament._id,
        category: 'girls_singles',
        player1: p._id,
        player2: null,
        isApproved: true
      });
    }

    // Boys Doubles (5 teams)
    for (let i = 0; i < maleParticipants.length; i += 2) {
      const p1 = maleParticipants[i];
      const p2 = maleParticipants[i + 1];
      if (p1 && p2) {
        await Team.create({
          name: `${p1.fullName} & ${p2.fullName}`,
          tournamentId: tournament._id,
          category: 'boys_doubles',
          player1: p1._id,
          player2: p2._id,
          isApproved: true
        });
      }
    }

    // Girls Doubles (4 teams)
    for (let i = 0; i < femaleParticipants.length; i += 2) {
      const p1 = femaleParticipants[i];
      const p2 = femaleParticipants[i + 1];
      if (p1 && p2) {
        await Team.create({
          name: `${p1.fullName} & ${p2.fullName}`,
          tournamentId: tournament._id,
          category: 'girls_doubles',
          player1: p1._id,
          player2: p2._id,
          isApproved: true
        });
      }
    }

    // Mixed Doubles (6 pairs)
    for (let i = 0; i < 6; i++) {
      const p1 = maleParticipants[i];
      const p2 = femaleParticipants[i];
      await Team.create({
        name: `${p1.fullName} & ${p2.fullName}`,
        tournamentId: tournament._id,
        category: 'mixed_doubles',
        player1: p1._id,
        player2: p2._id,
        isApproved: true
      });
    }

    console.log('[Seed] Created all approved category teams.');

    // 5. Generate Dynamic Knockout Draws
    console.log('[Seed] Generating dynamic knockout bracket for Boys Singles (10 teams -> P=16, 6 byes)...');
    await generateDynamicBracket(tournament._id, 'boys_singles', adminUser._id);

    console.log('[Seed] Generating dynamic knockout bracket for Girls Singles (8 teams -> P=8, 0 byes)...');
    await generateDynamicBracket(tournament._id, 'girls_singles', adminUser._id);

    console.log('[Seed] Generating dynamic knockout bracket for Boys Doubles (5 teams -> P=8, 3 byes)...');
    await generateDynamicBracket(tournament._id, 'boys_doubles', adminUser._id);

    console.log('[Seed] Generating dynamic knockout bracket for Girls Doubles (4 teams -> P=4, 0 byes)...');
    await generateDynamicBracket(tournament._id, 'girls_doubles', adminUser._id);

    tournament.drawsPublished.boys_singles = true;
    tournament.drawsPublished.girls_singles = true;
    tournament.drawsPublished.boys_doubles = true;
    tournament.drawsPublished.girls_doubles = true;
    tournament.drawsLocked.boys_singles = true;
    tournament.drawsLocked.girls_singles = true;
    tournament.drawsLocked.boys_doubles = true;
    tournament.drawsLocked.girls_doubles = true;
    tournament.markModified('drawsPublished');
    tournament.markModified('drawsLocked');
    await tournament.save();

    // 6. Set up Single Main Carrom Board Schedule & Exactly 1 LIVE Match
    const { generateSequentialSchedule, recalculateEstimatedTimes } = require('../services/scheduleEngine');
    await generateSequentialSchedule(tournament._id, {
      startTime: new Date(),
      matchDurationMinutes: 30,
      breakTimeMinutes: 5,
      minRestTimeMinutes: 10
    }, adminUser._id);

    // Fetch the first match in READY queue to make it the single LIVE match
    const firstReadyMatch = await Match.findOne({
      tournamentId: tournament._id,
      status: 'scheduled',
      isBye: false,
      team1: { $ne: null },
      team2: { $ne: null }
    }).sort({ queuePosition: 1 });

    if (firstReadyMatch) {
      firstReadyMatch.status = 'live';
      firstReadyMatch.boardName = 'Main Carrom Board';
      firstReadyMatch.carromBoardNumber = 1;
      firstReadyMatch.actualStartTime = new Date(Date.now() - 15 * 60 * 1000); // 15 mins in play
      firstReadyMatch.boards[0].team1Score = 12;
      firstReadyMatch.boards[0].team2Score = 7;
      firstReadyMatch.boards[0].queenPocketedBy = 'team1';
      firstReadyMatch.boards[0].queenCovered = true;
      firstReadyMatch.boards[0].team2Fouls = 1;
      firstReadyMatch.boards[0].boardWinner = 'team1';

      firstReadyMatch.boards[1].team1Score = 8;
      firstReadyMatch.boards[1].team2Score = 15;
      firstReadyMatch.boards[1].queenPocketedBy = 'team2';
      firstReadyMatch.boards[1].queenCovered = true;
      firstReadyMatch.boards[1].team1Fouls = 1;
      firstReadyMatch.boards[1].boardWinner = 'team2';

      // Board 3 currently in progress
      firstReadyMatch.boards[2].team1Score = 6;
      firstReadyMatch.boards[2].team2Score = 4;
      firstReadyMatch.finalScore = { team1BoardsWon: 1, team2BoardsWon: 1 };
      await firstReadyMatch.save();

      // Recalculate remaining READY queue estimated start times
      await recalculateEstimatedTimes(tournament._id);
    }

    // 7. Create Announcements
    await Announcement.create([
      {
        title: 'Tournament Draws Published & Sequential Schedule Active',
        content: 'Official dynamic knockout draws for Boys Singles, Girls Singles, Boys Doubles, and Girls Doubles are published. All matches will be played sequentially on the Main Carrom Board.',
        priority: 'urgent',
        isPinned: true
      },
      {
        title: 'Main Carrom Board Ready for Tournament Play',
        content: 'The tournament-grade Main Carrom Board is inspected and active in the Arena. Players must monitor the READY Queue and report 5 minutes prior to match call.',
        priority: 'normal',
        isPinned: false
      },
      {
        title: 'Reminder on Queen Scoring and Striker Fouls',
        content: 'According to Tournament Rules: Queen is worth 3 points only when successfully covered with another coin in the immediate shot. Pocketing the striker incurs a -1 point penalty and ends the player turn.',
        priority: 'normal',
        isPinned: false
      }
    ]);

    console.log('[Seed] Database seeded successfully with Main Carrom Board single-arena format!');
    process.exit(0);
  } catch (error) {
    console.error('[Seed] Error during seeding:', error);
    process.exit(1);
  }
};

seedDatabase();
