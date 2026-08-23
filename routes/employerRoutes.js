const express = require('express');
const router = express.Router();
const {
  upsertProfile,
  getProfile,
  addTeamMember,
  searchCandidates,
  createPaymentOrder,
  verifyPayment,
  getPaymentHistory
} = require('../controllers/employerController');
const { protect, authorize } = require('../middleware/authMiddleware');
const mobilePaymentController = require('../controllers/paymentController');

router.post('/profile', protect, authorize('employer'), upsertProfile);
router.get('/profile', protect, getProfile);
router.get('/profile/:id', protect, getProfile);
router.post('/team-member', protect, authorize('employer'), addTeamMember);
router.get('/candidates/search', protect, authorize('employer'), searchCandidates);
router.post('/payment/order', protect, authorize('employer'), createPaymentOrder);
router.post('/payment/create-order', protect, authorize('employer'), mobilePaymentController.createOrder);
router.post('/payment/verify', protect, authorize('employer'), mobilePaymentController.verifyPayment);
router.get('/payment/history', protect, authorize('employer'), getPaymentHistory);

module.exports = router;
