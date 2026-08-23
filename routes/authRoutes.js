const express = require('express');
const router = express.Router();
const { 
  sendOtp, 
  verifyOtp, 
  verifyFirebaseToken,
  selectRole, 
  getMe,
  savePushToken
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/verify-firebase-token', verifyFirebaseToken);
router.post('/select-role', protect, selectRole);
router.get('/me', protect, getMe);
router.post('/push-token', protect, savePushToken);

module.exports = router;
