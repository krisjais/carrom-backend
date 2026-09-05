const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      default: 'Annual Intra-College Carrom Championship'
    },
    edition: {
      type: String,
      required: true,
      default: '2026'
    },
    status: {
      type: String,
      enum: ['registration_open', 'registration_closed', 'ongoing', 'completed'],
      default: 'registration_open'
    },
    scheduleSettings: {
      startTime: {
        type: Date,
        default: () => new Date()
      },
      matchDurationMinutes: {
        type: Number,
        default: 30
      },
      breakTimeMinutes: {
        type: Number,
        default: 5
      },
      minRestTimeMinutes: {
        type: Number,
        default: 10
      }
    },
    rulesContent: {
      type: String,
      default: `### Tournament Rules

1. **Single Arena Format**: The entire tournament is played sequentially on the **Main Carrom Board**. Only one match can be LIVE at any time.
2. **Match Format**: All matches are played as **Best of 3 Boards**. The first player/team to win **2 boards** wins the match (2–0 or 2–1). Board 3 is played strictly if the first two boards result in 1–1.
3. **Point Scoring**:
   - Each white/black coin pocketed = **1 point**.
   - Queen pocketed = **3 points** ONLY when properly covered with another coin in the immediate shot.
   - Pocketing striker / foul penalty = **-1 point** and the turn ends.
   - Maximum achievable score for any single board = **25 points**.
4. **Board Confirmation**: Matches take place on the Main Carrom Board. The tournament Admin enters board points, Queen, and fouls, and manually confirms the winner.
5. **Advancement & Queue Rules**: Once confirmed, the match winner advances. When both opponents in a next-round match are determined, the match enters the READY queue in FIFO order.
6. **Rest Requirements**: Players participating across multiple categories receive a mandatory rest period between consecutive matches.
7. **Code of Conduct**: Players must report to the Main Carrom Board within 5 minutes of their match being called.`
    },
    drawsPublished: {
      boys_singles: { type: Boolean, default: false },
      girls_singles: { type: Boolean, default: false },
      boys_doubles: { type: Boolean, default: false },
      girls_doubles: { type: Boolean, default: false },
      mixed_doubles: { type: Boolean, default: false }
    },
    drawsLocked: {
      boys_singles: { type: Boolean, default: false },
      girls_singles: { type: Boolean, default: false },
      boys_doubles: { type: Boolean, default: false },
      girls_doubles: { type: Boolean, default: false },
      mixed_doubles: { type: Boolean, default: false }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tournament', tournamentSchema);
