const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment } = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/create-order', protect, authorize('employer'), createOrder);
router.post('/verify', protect, authorize('employer'), verifyPayment);

module.exports = router;
