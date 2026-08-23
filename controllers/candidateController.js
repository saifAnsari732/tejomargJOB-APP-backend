const cache = require('../utils/cache');
const { db, FieldValue } = require('../config/firebase');

// @desc    Create or update candidate profile
// @route   POST /api/candidate/profile
// @access  Private (Candidate)
const upsertProfile = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const profileData = { ...req.body, userId };
    
    // Calculate simple profile completion percentage
    let completedFields = 0;
    const totalFields = 6; // basic fields to check
    if (profileData.name) completedFields++;
    if (profileData.currentCity) completedFields++;
    if (profileData.education && profileData.education.length > 0) completedFields++;
    if (profileData.skills && profileData.skills.length > 0) completedFields++;
    if (profileData.preferredCategories && profileData.preferredCategories.length > 0) completedFields++;
    if (profileData.resumeUrl || profileData.videoResumeUrl) completedFields++;
    
    profileData.profileCompletionPercent = Math.round((completedFields / totalFields) * 100);

    // Save to candidateProfiles collection (App reads from here)
    const profileRef = db.collection('candidateProfiles').doc(userId);
    await profileRef.set(profileData, { merge: true });
    
    // Also sync to users collection for website compatibility
    // Website reads from users.candidateProfile.*
    const userSyncData = {
      name: profileData.name,
      'candidateProfile.skills': profileData.skills || [],
      'candidateProfile.expectedSalary': profileData.expectedSalary ? parseInt(profileData.expectedSalary) : 0,
      'candidateProfile.preferredLocation': profileData.currentCity || profileData.preferredLocation || '',
      'candidateProfile.experience': profileData.experience || [],
      'candidateProfile.education': profileData.education || [],
      'candidateProfile.resumeUrl': profileData.resumeUrl || '',
      // Mobile uses photoUrl while the web/reference app uses avatarUrl.
      // Keep both paths compatible when syncing the shared users document.
      'candidateProfile.avatarUrl': profileData.avatarUrl || profileData.photoUrl || '',
      'candidateProfile.mobile': profileData.mobile || profileData.phone || '',
      'candidateProfile.dob': profileData.dob || '',
      'candidateProfile.gender': profileData.gender || '',
      'candidateProfile.homeTown': profileData.homeTown || profileData.currentCity || '',
      'candidateProfile.totalExperience': profileData.totalExperience || '',
      'candidateProfile.noticePeriod': profileData.noticePeriod || '',
      'candidateProfile.highestEducation': profileData.highestEducation || '',
      'candidateProfile.languages': profileData.languages || [],
      'candidateProfile.certifications': profileData.certifications || [],
    };
    // Remove undefined values
    Object.keys(userSyncData).forEach(key => userSyncData[key] === undefined && delete userSyncData[key]);
    
    try {
      await db.collection('users').doc(userId).update(userSyncData);
    } catch (syncErr) {
      console.error('User sync error (non-fatal):', syncErr.message);
    }

    // Invalidate the enrich cache
    cache.del(`user_enrich_${userId}`);

    const updated = await profileRef.get();

    res.status(200).json({ _id: updated.id, ...updated.data() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get candidate profile by ID or own
// @route   GET /api/candidate/profile/:id?
// @access  Private
const getProfile = async (req, res) => {
  try {
    const userId = req.params.id || req.user._id || req.user.id;
    const profileDoc = await db.collection('candidateProfiles').doc(userId).get();

    const userDoc = await db.collection('users').doc(userId).get();
    if (!profileDoc.exists && !userDoc.exists) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Fall back to the shared users document so profiles created by the
    // reference web app are also visible in the mobile app.
    const profile = profileDoc.exists
      ? { _id: profileDoc.id, ...profileDoc.data() }
      : { _id: userId, userId };

    if (userDoc.exists) {
      const user = userDoc.data();
      const candidateProfile = user.candidateProfile || {};
      Object.assign(profile, {
        name: profile.name || user.name,
        mobile: profile.mobile || candidateProfile.mobile || user.phone,
        email: profile.email || user.email,
        resumeUrl: profile.resumeUrl || candidateProfile.resumeUrl,
        photoUrl: profile.photoUrl || candidateProfile.avatarUrl,
        avatarUrl: profile.avatarUrl || candidateProfile.avatarUrl,
      });
    }

    // Populate userId (phone, email)
    if (userDoc.exists) {
       profile.userId = {
         _id: userId,
         phone: userDoc.data().phone,
         email: userDoc.data().email
       };
    }

    res.status(200).json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get recommended jobs
// @route   GET /api/candidate/recommended-jobs
// @access  Private (Candidate)
const getRecommendedJobs = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const profileDoc = await db.collection('candidateProfiles').doc(userId).get();
    
    if (!profileDoc.exists) {
      return res.status(404).json({ message: 'Please complete your profile first' });
    }

    const profile = profileDoc.data();
    
    // Firebase doesn't support complex $or queries easily without multiple queries
    // We'll fetch active jobs and filter in memory for recommendations
    const jobsSnap = await db.collection('jobs').where('status', '==', 'active').get();
    
    let recommended = [];
    const empCache = {};

    for (let doc of jobsSnap.docs) {
      const job = { _id: doc.id, ...doc.data() };
      
      const matchCategory = profile.preferredCategories && profile.preferredCategories.includes(job.category);
      const matchLocation = profile.preferredLocations && job.location && profile.preferredLocations.includes(job.location.city);
      
      if (matchCategory || matchLocation) {
         if (job.employerId && !empCache[job.employerId]) {
            const empSnap = await db.collection('employerProfiles').doc(job.employerId).get();
            if (empSnap.exists) empCache[job.employerId] = empSnap.data();
         }

         if (job.employerId && empCache[job.employerId]) {
           job.employerId = {
             _id: job.employerId,
             companyName: empCache[job.employerId].companyName,
             logoUrl: empCache[job.employerId].logoUrl,
             isVerified: empCache[job.employerId].isVerified
           };
         }
         recommended.push(job);
      }
    }

    // Sort by newest
    recommended.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.status(200).json(recommended.slice(0, 20));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get saved/bookmarked jobs
// @route   GET /api/candidate/bookmarks
// @access  Private (Candidate)
const getBookmarks = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const savedJobIds = userDoc.data().savedJobs || [];
    
    const savedJobs = [];
    for (const jobId of savedJobIds) {
      const jobDoc = await db.collection('jobs').doc(jobId).get();
      if (jobDoc.exists) {
        const jobData = jobDoc.data();
        let companyData = null;
        if (jobData.companyId) {
          const compDoc = await db.collection('companies').doc(jobData.companyId).get();
          if (compDoc.exists) companyData = { _id: compDoc.id, ...compDoc.data() };
        }
        savedJobs.push({ _id: jobDoc.id, ...jobData, companyId: companyData });
      }
    }

    res.status(200).json({ savedJobs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Toggle bookmark (save/unsave job)
// @route   POST /api/candidate/bookmarks
// @access  Private (Candidate)
const toggleBookmark = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { jobId } = req.body;

    if (!jobId) {
      return res.status(400).json({ message: 'Job ID is required' });
    }

    // Verify job exists
    const jobDoc = await db.collection('jobs').doc(jobId).get();
    if (!jobDoc.exists) {
      return res.status(404).json({ message: 'Job posting not found' });
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const savedJobs = userDoc.data()?.savedJobs || [];
    const isBookmarked = savedJobs.includes(jobId);

    if (isBookmarked) {
      await userRef.update({ savedJobs: FieldValue.arrayRemove(jobId) });
      res.status(200).json({ bookmarked: false, message: 'Job removed from bookmarks.' });
    } else {
      await userRef.update({ savedJobs: FieldValue.arrayUnion(jobId) });
      res.status(200).json({ bookmarked: true, message: 'Job saved to bookmarks.' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  upsertProfile,
  getProfile,
  getRecommendedJobs,
  getBookmarks,
  toggleBookmark
};
