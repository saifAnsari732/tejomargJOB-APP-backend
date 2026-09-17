const Razorpay = require('razorpay');
const crypto = require('crypto');
const { db } = require('../config/firebase');

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

  const baseAmount = planPrices[planId] || 199;

  try {
    console.log('[Payment API] Create order request', { planId, jobId, hasCoupon: Boolean(couponCode) });
    
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.status(503).json({ message: 'Razorpay keys are not configured on the server' });
    }

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
      if (!couponSnapshot.empty) {
        discountPercent = Number(couponSnapshot.docs[0].data().discountPercentage) || 0;
      }
    }
    const amount = Math.max(1, Math.floor(baseAmount * (1 - discountPercent / 100)));

    const razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const options = {
      amount: amount * 100, // amount in paise
      currency: "INR",
      receipt: `receipt_job_${jobId}_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    console.log('[Payment API] Razorpay Order created', { orderId: order.id, amount: order.amount, jobId });
    
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
      key_id: keyId,
    });
  } catch (error) {
    console.error('Create Order Error:', error);
    res.status(500).json({ message: 'Failed to create payment order' });
  }
};

// @desc    Verify Razorpay Payment Signature strictly
// @route   POST /api/payment/verify
// @access  Private (Employer)
const verifyPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, jobId } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !jobId) {
    return res.status(400).json({ message: 'Missing payment verification parameters' });
  }

  try {
    console.log('[Payment API] Strict Verify Request', { jobId, orderId: razorpay_order_id, paymentId: razorpay_payment_id });
    const jobRef = db.collection('jobs').doc(jobId);
    const jobDoc = await jobRef.get();
    const userId = req.user._id || req.user.id;
    if (!jobDoc.exists || jobDoc.data().employerId !== userId) {
      return res.status(403).json({ message: 'You are not authorized to verify this job payment' });
    }

    if (jobDoc.data().paymentId === razorpay_payment_id && jobDoc.data().paymentStatus === 'paid') {
      return res.status(200).json({ message: 'Payment already verified', status: 'active', jobId });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(503).json({ message: 'Razorpay secret is not configured on server' });
    }

    // Verify HMAC SHA256 Signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac('sha256', secret)
                                    .update(body.toString())
                                    .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.warn('[Payment Failed] Signature mismatch!', { orderId: razorpay_order_id, paymentId: razorpay_payment_id });
      return res.status(400).json({ message: 'Invalid payment signature. Job was not published.' });
    }

    // Strict Activation upon verified payment signature
    await jobRef.update({
      status: 'active',
      paymentStatus: 'paid',
      paymentId: razorpay_payment_id,
      paymentOrderId: razorpay_order_id,
      paymentDate: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
    });

    const existingPayment = await db.collection('paymentHistory').where('paymentId', '==', razorpay_payment_id).limit(1).get();
    if (existingPayment.empty) {
      await db.collection('paymentHistory').add({
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
    }

    res.status(200).json({ message: 'Payment verified successfully. Job active!' });
  } catch (error) {
    console.error('Verify Payment Error:', error);
    res.status(500).json({ message: 'Failed to verify payment' });
  }
};

module.exports = {
  createOrder,
  verifyPayment
};
