const { db } = require('../config/firebase');
const axios = require('axios');

// Normalizer for Jobicy
function normalizeJobicyJob(j) {
  return {
    id: String(j.id),
    title: j.jobTitle,
    company: j.companyName,
    companyLogo: j.companyLogo || null,
    location: j.jobGeo || "Remote",
    type: (j.jobType && j.jobType[0]) ? j.jobType[0] : "FULLTIME",
    isRemote: true,
    salary: j.annualSalaryMax ? `$${j.annualSalaryMin} - $${j.annualSalaryMax}` : "Not Disclosed",
    description: (j.jobDescription || "").replace(/<[^>]+>/g, '').slice(0, 300) + "…",
    applyUrl: j.url,
    postedAt: j.pubDate || null,
    source: "External",
  };
}

// Mock jobs fallback
function getMockJobs(query, location) {
  return [
    {
      id: "mock-1",
      title: `${query || 'Software Engineer'} – Senior Role`,
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
    }
  ];
}

// @desc    Get live jobs from External API (with Firestore caching)
// @route   GET /api/jobs/live
// @access  Public / Candidate
const getLiveJobs = async (req, res) => {
  const query = req.query.query || "";
  const location = req.query.location || "India";

  try {
    // Jobicy returns up to 50 jobs per request by default. We can request count=50
    const url = 'https://jobicy.com/api/v2/remote-jobs?count=50';
    const response = await axios.get(url);
    
    let jobs = (response.data.jobs || []).map(normalizeJobicyJob);

    // Filter by query if provided
    if (query && query.toLowerCase() !== 'developer') {
      const q = query.toLowerCase();
      jobs = jobs.filter(j => 
        (j.title && j.title.toLowerCase().includes(q)) || 
        (j.description && j.description.toLowerCase().includes(q))
      );
    }

    // Sync to Firestore asynchronously
    Promise.all(jobs.map(async (job) => {
      try {
        const docId = `ext_jobicy_${job.id}`;
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
    console.error("External fetch error:", err.message);
    res.status(200).json({
      status: "mock",
      total: 1,
      jobs: getMockJobs(query, location),
    });
  }
};

module.exports = {
  getLiveJobs
};
