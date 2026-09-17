const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const sendNotification = require('../utils/sendNotification');

// @desc    Apply to a job
// @route   POST /api/applications
// @access  Private (Candidate)
const applyToJob = async (req, res) => {
  try {
    const { jobId, coverLetter, coverNote, screeningAnswers } = req.body;
    const userId = req.user._id || req.user.id;
    
    // Get candidate profile
    const candidateRef = db.collection('candidateProfiles').doc(userId);
    const candidateDoc = await candidateRef.get();
    const userDoc = await db.collection('users').doc(userId).get();
    const webProfile = userDoc.exists ? (userDoc.data().candidateProfile || {}) : {};
    
    if (!candidateDoc.exists && !userDoc.exists) {
      return res.status(400).json({ message: 'Please create your profile first to apply for jobs.' });
    }

    const candidateData = { 
      ...(userDoc.exists ? userDoc.data() : {}), 
      ...webProfile, 
      ...(candidateDoc.exists ? candidateDoc.data() : {}),
      ...(req.body.candidateProfile || {})
    };

    if (!candidateData.name && !userDoc.exists?.name) {
      return res.status(400).json({ message: 'Candidate name is required to apply.' });
    }

    // Ensure we fetch the user's phone number to send to the employer
    const candidatePhone = candidateData.phone || candidateData.mobile || (userDoc.exists ? userDoc.data().phone : '') || '';
    const candidateEmail = candidateData.email || (userDoc.exists ? userDoc.data().email : '') || '';
    const resumeUrl = req.body.resumeUrl || candidateData.resumeUrl || '';

    // Check if already applied
    const applicationsRef = db.collection('applications');
    const existing = await applicationsRef
      .where('jobId', '==', jobId)
      .where('candidateId', '==', userId)
      .get();
      
    if (!existing.empty) {
      return res.status(400).json({ message: 'Already applied to this job' });
    }

    const applicationData = {
      jobId,
      candidateId: userId,
      resumeUrl: resumeUrl,
      coverLetter: coverLetter || coverNote || '',
      coverNote: coverLetter || coverNote || '',
      candidateName: candidateData.name || '',
      candidatePhone: candidatePhone,
      candidateEmail: candidateEmail,
      candidateProfile: {
        name: candidateData.name || '',
        email: candidateEmail,
        phone: candidatePhone,
        mobile: candidatePhone,
        currentCity: candidateData.currentCity || candidateData.preferredLocation || candidateData.location || '',
        totalExperience: candidateData.totalExperience || candidateData.experience || '',
        highestEducation: candidateData.highestEducation || candidateData.education || '',
        skills: candidateData.skills || [],
        experience: candidateData.experience || [],
        education: candidateData.education || [],
        resumeUrl: resumeUrl,
        photoUrl: candidateData.photoUrl || candidateData.avatarUrl || '',
      },
      screeningAnswers: screeningAnswers || [],
      status: 'applied',
      statusHistory: [{ status: 'applied', updatedAt: new Date().toISOString(), note: 'Application submitted' }],
      contactUnlocked: false,
      createdAt: new Date().toISOString()
    };

    const docRef = await applicationsRef.add(applicationData);

    // Notify Employer
    const jobSnap = await db.collection('jobs').doc(jobId).get();
    if (jobSnap.exists) {
      const employerId = jobSnap.data().employerId;
      const candidateName = candidateData.name || 'A candidate';
      await sendNotification(
        employerId, 
        'New Job Application! 🚀', 
        `${candidateName} applied for your job: ${jobSnap.data().title}`,
        { type: 'application', jobId }
      );
    }

    res.status(201).json({ _id: docRef.id, ...applicationData });
  } catch (error) {
    console.error('Apply Job Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get candidate's applications
// @route   GET /api/applications/candidate/:id
// @access  Private (Candidate)
const getCandidateApplications = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    const snapshot = await db.collection('applications')
      .where('candidateId', '==', userId)
      .get();

    let applications = [];
    
    // Fetch related jobs and employers for population
    const jobCache = {};
    const empCache = {};

    for (let doc of snapshot.docs) {
      const app = { _id: doc.id, ...doc.data() };
      
      if (app.jobId) {
        if (!jobCache[app.jobId]) {
          const jobSnap = await db.collection('jobs').doc(app.jobId).get();
          if (jobSnap.exists) {
            jobCache[app.jobId] = { _id: jobSnap.id, ...jobSnap.data() };
            
            // Also fetch employer for this job
            const empId = jobCache[app.jobId].employerId;
            if (empId && !empCache[empId]) {
              const empSnap = await db.collection('employerProfiles').doc(empId).get();
              if (empSnap.exists) {
                empCache[empId] = { _id: empSnap.id, ...empSnap.data() };
              }
            }
            if (empId && empCache[empId]) {
               jobCache[app.jobId].employerId = {
                 _id: empId,
                 companyName: empCache[empId].companyName,
                 logoUrl: empCache[empId].logoUrl
               };
            }
          }
        }
        app.jobId = jobCache[app.jobId] || app.jobId;
      }
      
      applications.push(app);
    }

    applications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.status(200).json(applications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get applicants for a job
// @route   GET /api/applications/job/:jobId
// @access  Private (Employer)
const getJobApplications = async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const userId = req.user._id || req.user.id;

    // Verify job belongs to this employer
    const jobSnap = await db.collection('jobs').doc(jobId).get();
    if (!jobSnap.exists) return res.status(404).json({ message: 'Job not found' });
    
    if (jobSnap.data().employerId !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const snapshot = await db.collection('applications')
      .where('jobId', '==', jobId)
      .get();

    let applications = [];
    
    for (let doc of snapshot.docs) {
      const app = { _id: doc.id, ...doc.data() };
      
      // Populate candidate
      const candProfileData = app.candidateProfile || {};
      let userData = {};
      let candDocData = {};

      if (app.candidateId) {
        try {
          const userSnap = await db.collection('users').doc(app.candidateId).get();
          if (userSnap.exists) userData = userSnap.data();
          const candProfileSnap = await db.collection('candidateProfiles').doc(app.candidateId).get();
          if (candProfileSnap.exists) candDocData = candProfileSnap.data();
        } catch (fetchErr) {
          console.log('Error fetching candidate doc:', fetchErr);
        }
      }

      const webProfile = userData.candidateProfile || {};
      const mergedProfile = { ...candDocData, ...webProfile, ...candProfileData };

      app.candidateName = app.candidateName || mergedProfile.name || userData.name || 'Candidate';
      app.candidatePhone = app.candidatePhone || mergedProfile.phone || mergedProfile.mobile || userData.phone || '';
      app.candidateEmail = app.candidateEmail || mergedProfile.email || userData.email || '';
      app.resumeUrl = app.resumeUrl || mergedProfile.resumeUrl || '';
      app.candidateProfile = mergedProfile;

      app.candidateId = {
        _id: app.candidateId || doc.id,
        name: app.candidateName,
        email: app.candidateEmail,
        phone: app.candidatePhone,
        mobile: app.candidatePhone,
        skills: mergedProfile.skills || [],
        totalExperience: mergedProfile.totalExperience || mergedProfile.experience || 'Fresher',
        highestEducation: mergedProfile.highestEducation || mergedProfile.education || '',
        city: mergedProfile.currentCity || mergedProfile.preferredLocation || 'Location Not Provided',
        resume: app.resumeUrl,
        resumeUrl: app.resumeUrl,
        coverLetter: app.coverLetter || app.coverNote || '',
        profile: mergedProfile,
        userId: { email: app.candidateEmail, phone: app.candidatePhone }
      };
      
      applications.push(app);
    }

    applications.sort((a, b) => new Date(b.createdAt || b.appliedAt || 0) - new Date(a.createdAt || a.appliedAt || 0));
    res.status(200).json(applications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update application status
// @route   PUT /api/applications/:id/status
// @access  Private (Employer)
const updateApplicationStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    const appId = req.params.id;
    const userId = req.user._id || req.user.id;

    const allowedStatuses = ['applied', 'shortlisted', 'interview', 'rejected', 'hired'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be: applied, shortlisted, interview, rejected, or hired.' });
    }

    const appRef = db.collection('applications').doc(appId);
    const appSnap = await appRef.get();

    if (!appSnap.exists) return res.status(404).json({ message: 'Application not found' });
    
    // Verify employer ownership via Job
    const jobId = appSnap.data().jobId;
    const jobSnap = await db.collection('jobs').doc(jobId).get();
    
    if (!jobSnap.exists || jobSnap.data().employerId !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Update status with history tracking (matching website behavior)
    const existingHistory = appSnap.data().statusHistory || [];
    const updatedStatusHistory = [
      ...existingHistory,
      {
        status,
        updatedAt: new Date().toISOString(),
        note: note || `Status updated to ${status} by Recruiter.`,
      }
    ];

    await appRef.update({ status, statusHistory: updatedStatusHistory });

    // Notify Candidate
    const candidateId = appSnap.data().candidateId;
    let statusText = status;
    if (status === 'shortlisted') statusText = 'been Shortlisted 🎉';
    else if (status === 'rejected') statusText = 'not been selected this time';
    else if (status === 'hired') statusText = 'been HIRED! 🎊';
    else if (status === 'interview') statusText = 'been selected for Interview 📋';

    await sendNotification(
      candidateId,
      'Application Update',
      `Your application for ${jobSnap.data().title} has ${statusText}.`,
      { type: 'application', appId }
    );

    // Also create an in-app chat message when an employer shortlists a candidate.
    if (status === 'shortlisted' && candidateId) {
      const employerName = req.user.name || 'Employer';
      const chatText = `Good news! You have been shortlisted for ${jobSnap.data().title || 'this job'}.`;
      // Use a deterministic room id so shortlist notifications always appear
      // in the same chat, even when no conversation existed previously.
      const chatRef = db.collection('chats').doc(`job_${jobId}_${candidateId}`);
      await chatRef.set({ participants: [userId, candidateId], jobId, lastMessage: chatText, lastMessageAt: Date.now() }, { merge: true });
      await db.collection('messages').add({ chatId: chatRef.id, senderId: userId, text: chatText, createdAt: Date.now(), type: 'application' });
      await sendNotification(candidateId, `Message from ${employerName}`, chatText, { type: 'chat', chatId: chatRef.id, appId });
    }

    const updated = await appRef.get();
    res.status(200).json({ _id: updated.id, ...updated.data() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

const unlockContact = async (req, res) => {
  try {
    const appId = req.params.id;
    const userId = req.user._id || req.user.id;

    const appRef = db.collection('applications').doc(appId);
    const appSnap = await appRef.get();

    if (!appSnap.exists) return res.status(404).json({ message: 'Application not found' });

    // Verify employer ownership via Job
    const jobId = appSnap.data().jobId;
    const jobSnap = await db.collection('jobs').doc(jobId).get();
    
    if (!jobSnap.exists || jobSnap.data().employerId !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (appSnap.data().contactUnlocked) {
      return res.status(400).json({ message: 'Contact already unlocked' });
    }

    // Unlock contact without deducting credits (per cleanup plan)
    await appRef.update({ contactUnlocked: true });

    // Fetch phone to return it immediately
    const candId = appSnap.data().candidateId;
    const userSnap = await db.collection('users').doc(candId).get();
    const phone = userSnap.exists ? userSnap.data().phone : null;

    res.status(200).json({ message: 'Contact unlocked', phone });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all recent applications for employer
// @route   GET /api/applications/employer/recent
// @access  Private (Employer)
const getEmployerApplications = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    // Get all jobs by this employer
    const jobsSnap = await db.collection('jobs').where('employerId', '==', userId).get();
    if (jobsSnap.empty) return res.status(200).json([]);
    
    const jobDocs = jobsSnap.docs;
    const jobIds = jobDocs.map(doc => doc.id);
    
    let applications = [];
    
    // Chunk up to 30 elements for 'in' query
    const chunks = [];
    for (let i = 0; i < jobIds.length; i += 30) {
      chunks.push(jobIds.slice(i, i + 30));
    }
    
    for (const chunk of chunks) {
      const appsSnap = await db.collection('applications').where('jobId', 'in', chunk).get();
      for (let doc of appsSnap.docs) {
        const app = { _id: doc.id, ...doc.data() };
        
        // Populate candidate name
        if (app.candidateId) {
          const userSnap = await db.collection('users').doc(app.candidateId).get();
          const candProfileSnap = await db.collection('candidateProfiles').doc(app.candidateId).get();
          
          if (userSnap.exists) {
            const userData = userSnap.data();
            const candProfile = candProfileSnap.exists ? candProfileSnap.data() : {};
            const webProfile = userData.candidateProfile || {};
            
            app.candidateId = { 
              _id: app.candidateId, 
              name: app.candidateName || userData.name || candProfile.name || webProfile.name || 'Candidate',
              email: userData.email,
              phone: app.candidatePhone || userData.phone,
              skills: app.candidateProfile?.skills || candProfile.skills || webProfile.skills || [],
              expectedSalary: candProfile.expectedSalary || webProfile.expectedSalary 
                ? `₹${candProfile.expectedSalary || webProfile.expectedSalary}/yr` : 'Not specified',
              resume: app.resumeUrl || candProfile.resumeUrl || webProfile.resumeUrl || null,
              city: app.candidateProfile?.currentCity || candProfile.currentCity || webProfile.preferredLocation || candProfile.preferredLocation || 'Location Not Provided',
              profile: app.candidateProfile || { ...candProfile, ...webProfile },
              userId: { email: userData.email, phone: userData.phone }
            };
          } else {
             app.candidateId = { _id: app.candidateId, name: app.candidateName || 'Candidate' };
          }
        }
        
        // Populate Job Title
        const jobDoc = jobDocs.find(d => d.id === app.jobId);
        if (jobDoc) app.jobTitle = jobDoc.data().title;
        
        applications.push(app);
      }
    }
    
    applications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.status(200).json(applications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  applyToJob,
  getCandidateApplications,
  getJobApplications,
  updateApplicationStatus,
  unlockContact,
  getEmployerApplications
};
