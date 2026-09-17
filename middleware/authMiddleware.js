const jwt = require('jsonwebtoken');
const { db } = require('../config/firebase');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // ─── DEV MODE: Accept dev_token_ and test_token_ in local development ───
      const isDev = process.env.NODE_ENV !== 'production';
      if (isDev && (token.startsWith('dev_token_') || token.startsWith('test_token_'))) {
        // Try to find a real user by phone first
        const usersRef = db.collection('users');
        let userDoc = null;

        // Check if X-Dev-Phone header is sent (optional)
        const devPhone = req.headers['x-dev-phone'];
        if (devPhone) {
          const snapshot = await usersRef.where('phone', '==', devPhone).limit(1).get();
          if (!snapshot.empty) {
            userDoc = snapshot.docs[0];
          }
        }

        // Also try to find the most recent user in the database as fallback
        if (!userDoc) {
          const anyUserSnapshot = await usersRef.limit(1).get();
          if (!anyUserSnapshot.empty) {
            userDoc = anyUserSnapshot.docs[0];
          }
        }

        if (userDoc) {
          req.user = { _id: userDoc.id, ...userDoc.data() };
          delete req.user.otp;
        } else {
          // Absolute fallback — no users in DB at all
          req.user = {
            _id: 'dev_user_local',
            phone: '+919651111303',
            name: 'Dev User',
            role: 'employer',
            isVerified: true,
          };
        }
        req.isDevMode = true;
        return next();
      }
      // ─── END DEV MODE ───

      const secret = process.env.JWT_SECRET || 'tejomarg_secret_key_2026_dev';
      const decoded = jwt.verify(token, secret);
      
      const userDocRef = await db.collection('users').doc(decoded.id).get();
      if (!userDocRef.exists) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      req.user = { _id: userDocRef.id, ...userDocRef.data() };
      delete req.user.otp;
      
      next();
    } catch (error) {
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Not authorized for this role' });
    }
    next();
  };
};

module.exports = { protect, authorize };
