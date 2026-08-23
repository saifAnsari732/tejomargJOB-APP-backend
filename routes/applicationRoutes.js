const express = require('express');
const router = express.Router();
const {
  applyToJob,
  getCandidateApplications,
  getJobApplications,
  updateApplicationStatus,
  unlockContact,
  getEmployerApplications
} = require('../controllers/applicationController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/', protect, authorize('candidate'), applyToJob);
router.get('/my', protect, authorize('candidate'), getCandidateApplications);
router.get('/candidate/:id', protect, authorize('candidate'), getCandidateApplications);
router.get('/employer/recent', protect, authorize('employer'), getEmployerApplications);
router.get('/job/:jobId', protect, authorize('employer'), getJobApplications);
router.put('/:id/status', protect, authorize('employer'), updateApplicationStatus);
router.post('/:id/unlock-contact', protect, authorize('employer'), unlockContact);

module.exports = router;
