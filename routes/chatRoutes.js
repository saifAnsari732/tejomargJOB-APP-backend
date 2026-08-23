const express = require('express');
const router = express.Router();
const {
  getUserChats,
  getChatMessages,
  sendMessage,
} = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getUserChats);
router.post('/message', protect, sendMessage);
router.get('/:chatId/messages', protect, getChatMessages);

module.exports = router;
