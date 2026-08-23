const express = require('express');
const router = express.Router();
const {
  upsertProfile,
  getProfile,
  getRecommendedJobs,
  getBookmarks,
  toggleBookmark
} = require('../controllers/candidateController');
const { protect, authorize } = require('../middleware/authMiddleware');

router.post('/profile', protect, authorize('candidate'), upsertProfile);
// Keep parity with the Next.js reference API, which updates profiles with PUT.
router.put('/profile', protect, authorize('candidate'), upsertProfile);
router.get('/profile', protect, getProfile);
router.get('/profile/:id', protect, getProfile);
router.get('/recommended-jobs', protect, authorize('candidate'), getRecommendedJobs);
router.get('/bookmarks', protect, authorize('candidate'), getBookmarks);
router.post('/bookmarks', protect, authorize('candidate'), toggleBookmark);

module.exports = router;
