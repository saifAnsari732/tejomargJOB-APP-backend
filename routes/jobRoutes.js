const express = require('express');
const router = express.Router();
const {
  createJob,
  getJobs,
  getJobById,
  updateJob,
  deleteJob,
  getEmployerJobs
} = require('../controllers/jobController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { getLiveJobs } = require('../controllers/liveJobsController');

router.get('/live', getLiveJobs);
router.get('/employer/me', protect, authorize('employer'), getEmployerJobs);

router.route('/')
  .post(protect, authorize('employer'), createJob)
  .get(getJobs);

router.route('/:id')
  .get(getJobById)
  .put(protect, authorize('employer'), updateJob)
  .delete(protect, authorize('employer'), deleteJob);

module.exports = router;
