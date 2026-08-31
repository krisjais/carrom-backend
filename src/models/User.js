const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    password: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'participant'],
      default: 'participant'
    },
    fullName: {
      type: String,
      required: true
    },
    participantRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Participant',
      default: null
    }
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    if (!this.password || !candidatePassword) return false;
    // If password was stored as plain text in DB directly
    if (this.password === candidatePassword) {
      // Rehash and persist
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(candidatePassword, salt);
      await this.save();
      return true;
    }
    return bcrypt.compare(candidatePassword, this.password);
  } catch (err) {
    return false;
  }
};

module.exports = mongoose.model('User', userSchema);
