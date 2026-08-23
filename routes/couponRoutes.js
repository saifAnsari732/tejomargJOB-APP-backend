const express = require('express');
const { db } = require('../config/firebase');

const router = express.Router();

router.get('/verify', async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Coupon code is required' });

  try {
    const snapshot = await db.collection('coupons')
      .where('code', '==', code)
      .where('isActive', '==', true)
      .limit(1)
      .get();
    if (snapshot.empty) return res.status(404).json({ error: 'Invalid or inactive coupon code' });

    const coupon = snapshot.docs[0].data();
    return res.status(200).json({
      code,
      discountPercentage: Number(coupon.discountPercentage) || 0,
      message: 'Coupon applied successfully',
    });
  } catch (error) {
    console.error('Coupon verification error:', error);
    return res.status(500).json({ error: 'Failed to verify coupon' });
  }
});

module.exports = router;