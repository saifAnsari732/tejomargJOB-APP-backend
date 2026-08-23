const Razorpay = require('razorpay');
const crypto = require('crypto');
const { db } = require('../config/firebase');

// Ensure you have RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env.local
// @desc    Create Razorpay Order
// @route   POST /api/payment/create-order
// @access  Private (Employer)
const createOrder = async (req, res) => {
  const { planId, jobId, couponCode } = req.body;

  if (!planId || !jobId) {
    return res.status(400).json({ message: 'Plan ID and Job ID are required' });
  }

  // Define plan prices in INR
  const planPrices = {
    'basic': 199,
    'standard': 399,
    'premium': 499,
    'enterprise': 599
  };

  const baseAmount = planPrices[planId];
  if (!baseAmount) {
    return res.status(400).json({ message: 'Invalid plan selected' });
  }

  try {
    console.log('[Payment API] Create order request', { planId, jobId, hasCoupon: Boolean(couponCode) });
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ message: 'Razorpay is not configured on the server' });
    }
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const jobRef = db.collection('jobs').doc(jobId);
    const jobDoc = await jobRef.get();
    const userId = req.user._id || req.user.id;
    if (!jobDoc.exists || jobDoc.data().employerId !== userId) {
      return res.status(403).json({ message: 'You are not authorized to pay for this job' });
    }

    let discountPercent = 0;
    const normalizedCoupon = String(couponCode || '').trim().toUpperCase();
    if (normalizedCoupon) {
      const couponSnapshot = await db.collection('coupons')
        .where('code', '==', normalizedCoupon)
        .where('isActive', '==', true)
        .limit(1)
        .get();
      if (couponSnapshot.empty) return res.status(400).json({ message: 'Invalid or inactive coupon code' });
      discountPercent = Number(couponSnapshot.docs[0].data().discountPercentage) || 0;
    }
    const amount = Math.max(1, Math.floor(baseAmount * (1 - discountPercent / 100)));

    const options = {
      amount: amount * 100, // amount in smallest currency unit (paise)
      currency: "INR",
      receipt: `receipt_job_${jobId}_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    console.log('[Payment API] Order created', { orderId: order.id, amount: order.amount, jobId });
    
    // Save order details to the job temporarily
    await jobRef.update({
      razorpayOrderId: order.id,
      paymentStatus: 'pending',
      planSelected: planId,
      planBaseAmount: baseAmount,
      couponCode: discountPercent ? normalizedCoupon : null,
      discountPercent
    });

    res.status(200).json({
      message: 'Order created successfully',
      order,
      orderId: order.id,
      amount: order.amount,
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Create Order Error:', error);
    res.status(500).json({ message: 'Failed to create payment order' });
  }
};

// @desc    Verify Razorpay Payment
// @route   POST /api/payment/verify
// @access  Private (Employer)
const verifyPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, jobId } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !jobId) {
    return res.status(400).json({ message: 'Missing payment details' });
  }

  try {
    console.log('[Payment API] Verify request', { jobId, orderId: razorpay_order_id, paymentId: razorpay_payment_id });
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(503).json({ message: 'Razorpay is not configured on the server' });
    }
    const jobRef = db.collection('jobs').doc(jobId);
    const jobDoc = await jobRef.get();
    const userId = req.user._id || req.user.id;
    if (!jobDoc.exists || jobDoc.data().employerId !== userId) {
      return res.status(403).json({ message: 'You are not authorized to verify this job payment' });
    }
    if (jobDoc.data().paymentId === razorpay_payment_id && jobDoc.data().paymentStatus === 'paid') {
      return res.status(200).json({ message: 'Payment already verified', status: 'active', jobId });
    }
    if (jobDoc.data().razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ message: 'Payment order does not match this job' });
    }
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac('sha256', secret)
                                    .update(body.toString())
                                    .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // Payment is authentic
      await jobRef.update({
        status: 'active',
        paymentStatus: 'paid',
        paymentId: razorpay_payment_id,
        paymentOrderId: razorpay_order_id,
        paymentDate: new Date(),
        publishedAt: new Date(),
      });
      const existingPayment = await db.collection('paymentHistory').where('paymentId', '==', razorpay_payment_id).limit(1).get();
      if (existingPayment.empty) await db.collection('paymentHistory').add({
        employerId: userId,
        jobId,
        planId: jobDoc.data().planSelected || jobDoc.data().pricingPlan || 'basic',
        amount: Math.max(1, Math.floor((jobDoc.data().planBaseAmount || 0) * (100 - (Number(jobDoc.data().discountPercent) || 0)) / 100)),
        baseAmount: jobDoc.data().planBaseAmount || 0,
        couponCode: jobDoc.data().couponCode || null,
        discountPercent: Number(jobDoc.data().discountPercent) || 0,
        paymentId: razorpay_payment_id,
        paymentOrderId: razorpay_order_id,
        status: 'paid',
        createdAt: new Date().toISOString(),
      });
      console.log('[Payment API] Payment verified', { jobId, paymentId: razorpay_payment_id });

      res.status(200).json({ message: 'Payment verified successfully' });
    } else {
      res.status(400).json({ message: 'Invalid signature. Payment verification failed' });
    }
  } catch (error) {
    console.error('Verify Payment Error:', error);
    res.status(500).json({ message: 'Failed to verify payment' });
  }
};

module.exports = {
  createOrder,
  verifyPayment
};
