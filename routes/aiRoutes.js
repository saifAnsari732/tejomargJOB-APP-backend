const express = require('express');
const router = express.Router();
const { generateJobDescription, generateBio } = require('../controllers/aiController');
// const { protect, employerOnly } = require('../middleware/authMiddleware'); 
// Assuming we have middleware, if not we'll just leave it open for now or add it.

router.post('/generate-job-description', generateJobDescription);
router.post('/generate-bio', generateBio);

module.exports = router;
