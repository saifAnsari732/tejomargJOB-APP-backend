const { db, FieldValue } = require('../config/firebase');

// @desc    Create a job
// @route   POST /api/jobs
// @access  Private (Employer)
const createJob = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const companySnapshot = await db.collection('companies').where('employerId', '==', userId).limit(1).get();

    if (companySnapshot.empty) {
      return res.status(404).json({ message: 'Employer profile required to post a job. Please complete your Company Profile first.' });
    }

    const { title, description, location, category, jobType, deadline } = req.body;
    const experienceRequired = req.body.experienceRequired || req.body.experienceLevel;
    const skills = Array.isArray(req.body.skills) ? req.body.skills : (req.body.skillsRequired || '').split(',').map(skill => skill.trim()).filter(Boolean);
    console.log('[Job API] Create request', {
      title: title || '', category: category || '', jobType: jobType || '', location: location || '',
      experienceRequired: experienceRequired || '', deadline: deadline || '', openings: req.body.openings || '',
      skillsCount: skills.length, hasDescription: Boolean(description), isDraft: Boolean(req.body.isDraft),
    });
    if (!title || !description || !location || !category || !jobType || !experienceRequired || !deadline || skills.length === 0) {
      console.warn('[Job API] Validation failed', {
        missing: ['title', 'description', 'location', 'category', 'jobType', 'experienceRequired', 'deadline', 'skills']
          .filter(field => field === 'skills' ? skills.length === 0 : !req.body[field]),
      });
      return res.status(400).json({ message: 'Required job fields are missing' });
    }

    const jobData = {
      ...req.body,
      employerId: userId,
      status: req.body.isDraft ? 'draft' : 'pending_payment',
      skillsRequired: skills,
      createdAt: new Date().toISOString(),
      viewCount: 0,
      isBoosted: false
    };

    const docRef = await db.collection('jobs').add(jobData);
    console.log('[Job API] Job created', { jobId: docRef.id, status: jobData.status });
    res.status(201).json({ _id: docRef.id, ...jobData });
  } catch (error) {
    console.error('Create Job Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all jobs (with filters)
// @route   GET /api/jobs
// @access  Public
const getJobs = async (req, res) => {
  try {
    const { category, city, type, search } = req.query;
    let jobsRef = db.collection('jobs').where('status', '==', 'active');

    if (category) jobsRef = jobsRef.where('category', '==', category);
    if (city) jobsRef = jobsRef.where('location', '==', city); // Note: Simple match for now
    if (type) jobsRef = jobsRef.where('jobType', '==', type);

    const snapshot = await jobsRef.get();
    let jobs = [];
    
    // Fetch employers for population
    const employerDocs = {};

    for (let doc of snapshot.docs) {
      const job = { _id: doc.id, ...doc.data() };
      
      // Basic text search filter in memory since Firestore doesn't support full-text well natively
      if (search) {
        const searchText = search.toLowerCase();
        const titleMatch = job.title && job.title.toLowerCase().includes(searchText);
        const descMatch = job.description && job.description.toLowerCase().includes(searchText);
        if (!titleMatch && !descMatch) continue;
      }

      // Populate employer
      if (job.employerId && !employerDocs[job.employerId]) {
        const empSnap = await db.collection('companies').where('employerId', '==', job.employerId).limit(1).get();
        if (!empSnap.empty) employerDocs[job.employerId] = empSnap.docs[0].data();
      }

      if (job.employerId && employerDocs[job.employerId]) {
        job.employerId = {
          _id: job.employerId,
          companyName: employerDocs[job.employerId].name || employerDocs[job.employerId].employerName,
          logoUrl: employerDocs[job.employerId].logo,
          isVerified: employerDocs[job.employerId].isVerified
        };
      }

      jobs.push(job);
    }

    // Sort by created At desc
    jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json(jobs);
  } catch (error) {
    console.error('Get Jobs Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get job by ID
// @route   GET /api/jobs/:id
// @access  Public
const getJobById = async (req, res) => {
  try {
    const jobDoc = await db.collection('jobs').doc(req.params.id).get();

    if (!jobDoc.exists) {
      return res.status(404).json({ message: 'Job not found' });
    }

    const job = { _id: jobDoc.id, ...jobDoc.data() };

    // Increment view count
    await db.collection('jobs').doc(req.params.id).update({
      viewCount: FieldValue.increment(1)
    });

    // Populate employer
    if (job.employerId) {
      const empSnap = await db.collection('companies').where('employerId', '==', job.employerId).limit(1).get();
      if (!empSnap.empty) {
        job.employerId = { _id: empSnap.docs[0].id, ...empSnap.docs[0].data() };
      }
    }

    res.status(200).json(job);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update a job
// @route   PUT /api/jobs/:id
// @access  Private (Employer)
const updateJob = async (req, res) => {
  try {
    const jobRef = db.collection('jobs').doc(req.params.id);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) {
      return res.status(404).json({ message: 'Job not found' });
    }

    const job = jobDoc.data();
    const userId = req.user._id || req.user.id;

    if (job.employerId !== userId) {
      return res.status(403).json({ message: 'Not authorized to update this job' });
    }

    const updateData = { ...req.body };
    if (updateData.isDraft === true) updateData.status = 'draft';
    if (updateData.status === 'active' && !job.paymentId) {
      return res.status(402).json({ message: 'Payment is required before activating this job.' });
    }
    delete updateData.employerId;
    delete updateData.createdAt;
    await jobRef.update(updateData);
    
    const updated = await jobRef.get();
    res.status(200).json({ _id: updated.id, ...updated.data() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Delete a job
// @route   DELETE /api/jobs/:id
// @access  Private (Employer)
const deleteJob = async (req, res) => {
  try {
    const jobRef = db.collection('jobs').doc(req.params.id);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) {
      return res.status(404).json({ message: 'Job not found' });
    }

    const userId = req.user._id || req.user.id;
    if (jobDoc.data().employerId !== userId) {
      return res.status(403).json({ message: 'Not authorized to delete this job' });
    }

    await jobRef.delete();
    res.status(200).json({ message: 'Job removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get jobs by logged in employer
// @route   GET /api/jobs/employer/me
// @access  Private (Employer)
const getEmployerJobs = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const jobsSnapshot = await db.collection('jobs').where('employerId', '==', userId).get();
    let jobs = [];
    
    for (let doc of jobsSnapshot.docs) {
      const jobData = doc.data();
      // Get applicant count for this job
      const appsSnap = await db.collection('applications').where('jobId', '==', doc.id).count().get();
      jobData.applicants = appsSnap.data().count;
      
      jobs.push({ _id: doc.id, ...jobData });
    }
    
    jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.status(200).json(jobs);
  } catch (error) {
    console.error('Get Employer Jobs Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createJob,
  getJobs,
  getJobById,
  updateJob,
  deleteJob,
  getEmployerJobs
};
