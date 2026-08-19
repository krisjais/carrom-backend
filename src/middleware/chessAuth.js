const jwt = require('jsonwebtoken');
const User = require('../models/User');

const chessAdminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Admin authentication required.' });
    }

    const token = authHeader.split(' ')[1];

    // Check special admin token or JWT token
    if (token === 'chess_admin_token_secret_2026') {
      req.user = { role: 'admin', username: 'admin' };
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'carrom_championship_super_secure_jwt_secret_key_2026');
      const user = await User.findById(decoded.id).select('-password');
      if (user && user.role === 'admin') {
        req.user = user;
        return next();
      }
    } catch (err) {
      // Ignore inner verify error and fail auth below
    }

    return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid authentication token.' });
  }
};

module.exports = { chessAdminAuth };
