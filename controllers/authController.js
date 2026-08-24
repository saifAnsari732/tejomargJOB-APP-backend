const { db, FieldValue, adminAuth } = require('../config/firebase');
const generateToken = require('../utils/generateToken');
const cache = require('../utils/cache');

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (String(value || '').startsWith('+')) return `+${digits}`;
  return `+${digits}`;
};

const enrichUserData = async (userId, user) => {
  const cacheKey = `user_enrich_${userId}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    console.log(`[Cache Hit] user_enrich_${userId}`);
    return cachedData;
  }

  const enriched = { ...user };
  delete enriched.otp;
  delete enriched.otpExpiry;
  enriched._id = userId;

  if (enriched.role === 'employer') {
    const companySnap = await db.collection("companies").where("employerId", "==", userId).limit(1).get();
    if (!companySnap.empty) {
      const companyData = companySnap.docs[0].data();
      enriched.company = companyData;
      if (!enriched.name && companyData.employerName) enriched.name = companyData.employerName;
      if (!enriched.photoUrl && companyData.logo) enriched.photoUrl = companyData.logo;
    }
  } else if (enriched.role === 'candidate') {
    const profileSnap = await db.collection('candidateProfiles').doc(userId).get();
    if (profileSnap.exists) {
      const profileData = profileSnap.data();
      enriched.profile = profileData;
      if (!enriched.name && profileData.name) enriched.name = profileData.name;
      if (!enriched.photoUrl && (profileData.photoUrl || profileData.avatarUrl)) {
        enriched.photoUrl = profileData.photoUrl || profileData.avatarUrl;
      }
    }
    if (enriched.candidateProfile) {
      if (!enriched.name && enriched.candidateProfile.name) enriched.name = enriched.candidateProfile.name;
      if (!enriched.photoUrl && enriched.candidateProfile.avatarUrl) enriched.photoUrl = enriched.candidateProfile.avatarUrl;
    }
  }

  cache.set(cacheKey, enriched, 300); // Cache for 5 mins
  return enriched;
};

// @desc    Send OTP to phone (Mock)
// @route   POST /api/auth/send-otp
// @access  Public
const sendOtp = async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ message: 'Please provide a phone number' });
  }

  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('phone', '==', phone).get();
    
    let userId;
    let userData;

    if (snapshot.empty) {
      const newUser = { phone, createdAt: new Date() };
      const docRef = await usersRef.add(newUser);
      userId = docRef.id;
      userData = newUser;
    } else {
      userId = snapshot.docs[0].id;
      userData = snapshot.docs[0].data();
    }

    // MOCK OTP generation (e.g., always 123456 or random 6 digits)
    const mockOtp = '123456';
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await usersRef.doc(userId).update({
      otp: mockOtp,
      otpExpiry: otpExpiry
    });

    res.status(200).json({ message: 'OTP sent successfully (Mock: 123456)' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Verify OTP and login
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOtp = async (req, res) => {
  const { phone, otp, role } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ message: 'Please provide phone and OTP' });
  }

  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('phone', '==', phone).get();

    let userId;
    let user;

    if (snapshot.empty) {
      if (otp !== '123123' && otp !== '123456') {
        return res.status(400).json({ message: 'Invalid OTP' });
      }
      // Create user if they don't exist (Mock OTP flow)
      user = { phone, isVerified: true, createdAt: new Date() };
      if (role) user.role = role;
      if (req.body.name) user.name = req.body.name;
      const docRef = await usersRef.add(user);
      userId = docRef.id;
    } else {
      const userDoc = snapshot.docs[0];
      user = userDoc.data();
      userId = userDoc.id;

      if (user.otp !== otp && otp !== '123123' && otp !== '123456') {
        return res.status(400).json({ message: 'Invalid OTP' });
      }
    }

    if (user.otpExpiry) {
      if (user.otpExpiry.toDate && user.otpExpiry.toDate() < new Date()) {
         return res.status(400).json({ message: 'OTP expired' });
      } else if (new Date(user.otpExpiry) < new Date()) {
         return res.status(400).json({ message: 'OTP expired' });
      }
    }

    const updates = {
      otp: FieldValue.delete(),
      otpExpiry: FieldValue.delete(),
      isVerified: true
    };

    if (role) {
      updates.role = role;
      user.role = role;
    }
    if (req.body.name) {
      updates.name = req.body.name;
      user.name = req.body.name;
    }

    await usersRef.doc(userId).update(updates);

    // INVALIDATE CACHE to prevent stale roles!
    cache.del(`user_enrich_${userId}`);

    const token = generateToken(userId, user.role);
    const enrichedUser = await enrichUserData(userId, user);

    res.status(200).json({
      ...enrichedUser,
      token,
    });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

// @desc    Verify Firebase ID Token and login
// @route   POST /api/auth/verify-firebase-token
// @access  Public
const verifyFirebaseToken = async (req, res) => {
  const { firebaseToken, role, phone: expectedPhone } = req.body;

  if (!firebaseToken) {
    return res.status(400).json({ message: 'Please provide firebase token' });
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(firebaseToken);
    const phone = normalizePhone(decodedToken.phone_number);
    const normalizedExpectedPhone = normalizePhone(expectedPhone);

    if (!phone) {
      return res.status(400).json({ message: 'No phone number linked to this token' });
    }
    if (normalizedExpectedPhone && normalizedExpectedPhone !== phone) {
      return res.status(401).json({ message: 'Verified phone number does not match the requested login number' });
    }

    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('phone', '==', phone).get();

    let userId;
    let user;

    if (snapshot.empty) {
      // Create user if they don't exist
      user = { phone, isVerified: true, createdAt: new Date() };
      if (role) user.role = role;
      if (req.body.name) user.name = req.body.name;
      const docRef = await usersRef.add(user);
      userId = docRef.id;
    } else {
      const userDoc = snapshot.docs[0];
      user = userDoc.data();
      userId = userDoc.id;

      const updates = { isVerified: true };
      if (role) {
        updates.role = role;
        user.role = role;
      }
      if (req.body.name) {
        updates.name = req.body.name;
        user.name = req.body.name;
      }
      await usersRef.doc(userId).update(updates);
    }

    // INVALIDATE CACHE to prevent stale roles!
    cache.del(`user_enrich_${userId}`);

    const token = generateToken(userId, user.role);
    const enrichedUser = await enrichUserData(userId, user);

    res.status(200).json({
      ...enrichedUser,
      token,
    });
  } catch (error) {
    console.error('Verify Firebase Token Error:', error);
    res.status(401).json({ message: 'Invalid or expired Firebase token' });
  }
};

// @desc    Select Role
// @route   POST /api/auth/select-role
// @access  Private
const selectRole = async (req, res) => {
  const { role, name } = req.body;

  if (!['candidate', 'employer'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role' });
  }

  try {
    const userId = req.user._id || req.user.id;
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userDoc.data();
    
    const updateData = { role };
    if (name) updateData.name = name;

    await userRef.update(updateData);

    // INVALIDATE CACHE to prevent stale roles!
    cache.del(`user_enrich_${userId}`);

    const token = generateToken(userId, role); // re-issue token with role
    const enrichedUser = await enrichUserData(userId, { ...user, ...updateData });

    res.status(200).json({
      ...enrichedUser,
      token,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
       return res.status(404).json({ message: 'User not found' });
    }
    
    const enrichedUser = await enrichUserData(userId, userDoc.data());
    res.status(200).json(enrichedUser);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Save Push Token
// @route   POST /api/auth/push-token
// @access  Private
const savePushToken = async (req, res) => {
  const { pushToken } = req.body;
  
  if (!pushToken) {
    return res.status(400).json({ message: 'Push token is required' });
  }

  try {
    const userId = req.user._id || req.user.id;
    await db.collection('users').doc(userId).update({ pushToken });
    res.status(200).json({ message: 'Push token saved successfully' });
  } catch (error) {
    console.error('Save Push Token Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  verifyFirebaseToken,
  selectRole,
  getMe,
  savePushToken
};
