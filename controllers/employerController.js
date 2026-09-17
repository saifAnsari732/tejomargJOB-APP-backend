const { db } = require('../config/firebase');
const Razorpay = require('razorpay');
const cache = require('../utils/cache');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const crypto = require('crypto');

// @desc    Create or update employer profile
// @route   POST /api/employer/profile
// @access  Private (Employer)
const upsertProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const body = req.body;
    
    const snapshot = await db.collection("companies").where("employerId", "==", userId).limit(1).get();
    
    let updatedData = {
      name: body.name || "",
      logo: body.logo || "",
      description: body.description || "",
      website: body.website || "",
      industry: body.industry || "",
      location: body.location || "",
      employerName: body.employerName || "",
      billingEmail: body.billingEmail || "",
      contactNumber: body.contactNumber || "",
      employerId: userId,
      updatedAt: new Date().toISOString()
    };

    let companyId;
    if (snapshot.empty) {
      updatedData.createdAt = new Date().toISOString();
      const ref = await db.collection("companies").add(updatedData);
      companyId = ref.id;
    } else {
      companyId = snapshot.docs[0].id;
      await db.collection("companies").doc(companyId).update(updatedData);
    }

    if (updatedData.employerName) {
      await db.collection("users").doc(userId).update({ name: updatedData.employerName }).catch(e => console.log('Update user err:', e));
    }

    // Invalidate the enrich cache
    cache.del(`user_enrich_${userId}`);

    res.status(200).json({ _id: companyId, ...updatedData });
  } catch (error) {
    console.error("Upsert Profile Error:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get employer profile by ID or own
// @route   GET /api/employer/profile/:id?
// @access  Private
const getProfile = async (req, res) => {
  try {
    const userId = req.params.id || req.user._id || req.user.id;
    const snapshot = await db.collection("companies").where("employerId", "==", userId).limit(1).get();

    if (snapshot.empty) {
      const userDoc = await db.collection("users").doc(userId).get();
      if (userDoc.exists) {
        return res.status(200).json({
           billingEmail: userDoc.data().email || '',
           contactNumber: userDoc.data().phone || '',
           employerName: userDoc.data().name || ''
        });
      }
      // In dev mode, return mock profile so dashboard renders
      if (req.isDevMode) {
        return res.status(200).json({
          name: req.user.name || 'Dev Company',
          phone: req.user.phone || '',
          role: 'employer',
          isVerified: false,
        });
      }
      return res.status(404).json({ message: 'Profile not found' });
    }

    const doc = snapshot.docs[0];
    res.status(200).json({ _id: doc.id, ...doc.data() });
  } catch (error) {
    console.error("Get Profile Error:", error);
    if (req.isDevMode) {
      return res.status(200).json({
        name: req.user?.name || 'Dev Company',
        phone: req.user?.phone || '',
        role: 'employer',
        isVerified: false,
      });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Add a team member
// @route   POST /api/employer/team-member
// @access  Private (Employer)
const addTeamMember = async (req, res) => {
  try {
    const { userId, roleInCompany } = req.body;
    const myId = req.user._id || req.user.id;
    const employerRef = db.collection('employerProfiles').doc(myId);
    const profileDoc = await employerRef.get();

    if (!profileDoc.exists) {
      return res.status(404).json({ message: 'Employer profile not found' });
    }

    const profile = profileDoc.data();
    const teamMembers = profile.teamMembers || [];
    teamMembers.push({ userId, roleInCompany });

    await employerRef.update({ teamMembers });

    profile.teamMembers = teamMembers;
    res.status(200).json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Search candidates database
// @route   GET /api/employer/candidates/search
// @access  Private (Employer)
const searchCandidates = async (req, res) => {
  try {
    const { skill, city } = req.query;
    let candidatesRef = db.collection('candidateProfiles');

    // Firestore queries are limited, using simplistic matching for demonstration
    if (city) {
      candidatesRef = candidatesRef.where('currentCity', '==', city);
    }
    
    // For arrays like skills, array-contains could be used:
    if (skill) {
      candidatesRef = candidatesRef.where('skills', 'array-contains', skill);
    }

    const snapshot = await candidatesRef.limit(50).get();
    const candidates = [];
    
    snapshot.forEach(doc => {
      candidates.push({ id: doc.id, ...doc.data() });
    });

    res.status(200).json(candidates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Create Razorpay Order
// @route   POST /api/employer/payment/order
// @access  Private (Employer)
const createPaymentOrder = async (req, res) => {
  try {
    const { amount } = req.body; // e.g., 500 for Rs. 500
    
    const options = {
      amount: amount * 100, // amount in smallest currency unit (paise)
      currency: "INR",
      receipt: "receipt_order_" + Date.now(),
    };
    
    const order = await razorpay.orders.create(options);
    
    if (!order) {
      return res.status(500).json({ message: 'Some error occurred' });
    }
    
    res.status(200).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error generating order' });
  }
};

// @desc    Verify Razorpay Payment
// @route   POST /api/employer/payment/verify
// @access  Private (Employer)
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, jobId } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSign) {
      // Signature matches, update job status if jobId is provided
      if (jobId) {
        const jobRef = db.collection('jobs').doc(jobId);
        const jobDoc = await jobRef.get();
        if (jobDoc.exists && jobDoc.data().employerId === (req.user._id || req.user.id)) {
          // Update job status
          await jobRef.update({
            status: 'active',
            paymentId: razorpay_payment_id,
            updatedAt: new Date().toISOString()
          });

          // Add to payment history
          await db.collection('paymentHistory').add({
            employerId: req.user._id || req.user.id,
            jobId: jobId,
            jobTitle: jobDoc.data().title,
            razorpay_order_id,
            razorpay_payment_id,
            amount: 499, // Fallback/default, usually passed from request or lookup
            status: 'success',
            createdAt: new Date().toISOString()
          });
        }
      }
      return res.status(200).json({ message: "Payment verified successfully", success: true });
    } else {
      return res.status(400).json({ message: "Invalid signature sent!", success: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error verifying payment' });
  }
};

// @desc    Get payment history
// @route   GET /api/employer/payment/history
// @access  Private (Employer)
const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const historyRef = db.collection('paymentHistory').where('employerId', '==', userId);
    const snapshot = await historyRef.get();
    
    const history = [];
    snapshot.forEach(doc => {
      history.push({ id: doc.id, ...doc.data() });
    });
    // Backfill history for payments verified before paymentHistory records
    // were introduced, using paid jobs as the source of truth.
    if (history.length === 0) {
      const jobsSnap = await db.collection('jobs').where('employerId', '==', userId).get();
      jobsSnap.forEach(doc => {
        const job = doc.data();
        if (job.paymentId || job.paymentStatus === 'paid') {
          history.push({
            id: `job_${doc.id}`,
            jobId: doc.id,
            title: job.title,
            paymentId: job.paymentId,
            paymentOrderId: job.paymentOrderId || job.razorpayOrderId,
            amount: job.planBaseAmount || 0,
            couponCode: job.couponCode || null,
            discountPercent: Number(job.discountPercent) || 0,
            status: 'paid',
            createdAt: job.paymentDate || job.publishedAt || job.createdAt,
          });
        }
      });
    }

    // Sort by newest first
    history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json(history);
  } catch (error) {
    console.error('Get Payment History Error:', error);
    res.status(500).json({ message: 'Server error fetching history' });
  }
};

module.exports = {
  upsertProfile,
  getProfile,
  addTeamMember,
  searchCandidates,
  createPaymentOrder,
  verifyPayment,
  getPaymentHistory
};
