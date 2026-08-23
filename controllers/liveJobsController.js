const { db } = require('../config/firebase');
const axios = require('axios');

// Normalizer for Remotive
function normalizeRemotiveJob(j) {
  return {
    id: String(j.id),
    title: j.title,
    company: j.company_name,
    companyLogo: j.company_logo || null,
    location: j.candidate_required_location || "Remote",
    type: "FULLTIME",
    isRemote: true,
    salary: j.salary || "Not Disclosed",
    description: (j.description || "").replace(/<[^>]+>/g, '').slice(0, 300) + "…",
    applyUrl: j.url,
    postedAt: j.publication_date || null,
    source: "Remotive",
  };
}

// Mock jobs fallback
function getMockJobs(query, location) {
  return [
    {
      id: "mock-1",
      title: `${query} – Senior Role`,
      company: "Infosys Ltd",
      companyLogo: null,
      location: `Bangalore, ${location}`,
      type: "FULLTIME",
      isRemote: false,
      salary: "INR 12,00,000 – 18,00,000 / year",
      description: "Work with cutting-edge technologies to build scalable enterprise solutions. You will collaborate with cross-functional teams and deliver high-quality software products.",
      applyUrl: "https://www.infosys.com/careers",
      postedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      source: "Mock Data",
    },
    {
      id: "mock-3",
      title: `Remote ${query}`,
      company: "Razorpay",
      companyLogo: null,
      location: "Remote, India",
      type: "FULLTIME",
      isRemote: true,
      salary: "INR 20,00,000 – 30,00,000 / year",
      description: "Join India's leading fintech startup. Work fully remote and build financial infrastructure used by millions of businesses across India.",
      applyUrl: "https://razorpay.com/jobs",
      postedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      source: "Mock Data",
    }
  ];
}

// @desc    Get live jobs from Remotive API (with Firestore caching)
// @route   GET /api/jobs/live
// @access  Public / Candidate
const getLiveJobs = async (req, res) => {
  const query = req.query.query || "Software Developer";
  const location = req.query.location || "India";

  try {
    const response = await axios.get(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=100`);
    const raw = response.data;
    
    let jobs = (raw.jobs || []).map(normalizeRemotiveJob);

    // Sync to Firestore asynchronously
    Promise.all(jobs.map(async (job) => {
      try {
        const docId = `ext_remotive_${job.id}`;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 60);

        const newJob = {
          title: job.title,
          companyName: job.company,
          companyLogo: job.companyLogo,
          location: job.location,
          type: job.type,
          workMode: job.isRemote ? "remote" : "onsite",
          salaryMin: job.salary !== "Not Disclosed" ? job.salary : "",
          description: job.description, 
          applyUrl: job.applyUrl,
          source: job.source,
          isExternal: true,
          status: "active",
          createdAt: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
          employerId: "SYSTEM_EXTERNAL",
        };

        await db.collection("jobs").doc(docId).set(newJob, { merge: true });
      } catch (err) {
        console.error("Failed to sync job to DB:", err);
      }
    }));

    res.status(200).json({
      status: "live",
      total: jobs.length,
      jobs: jobs.length > 0 ? jobs : getMockJobs(query, location),
    });
  } catch (err) {
    console.error("Remotive fetch error:", err.message);
    res.status(200).json({
      status: "mock",
      total: 2,
      jobs: getMockJobs(query, location),
    });
  }
};

module.exports = {
  getLiveJobs
};
