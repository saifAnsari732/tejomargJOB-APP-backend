const { db } = require('../config/firebase');

// @desc    Get user's notifications
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const snapshot = await db.collection('notifications')
      .where('userId', '==', userId)
      .get();
      
    let notifications = [];
    snapshot.forEach(doc => notifications.push({ _id: doc.id, ...doc.data() }));
    
    // Sort by newest first
    notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.status(200).json(notifications);
  } catch (error) {
    console.error('Get Notifications Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Mark a notification as read
// @route   PATCH /api/notifications/:id/read
// @access  Private
const markAsRead = async (req, res) => {
  try {
    const notifId = req.params.id;
    await db.collection('notifications').doc(notifId).update({ isRead: true });
    res.status(200).json({ message: 'Marked as read' });
  } catch (error) {
    console.error('Mark Read Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Mark all notifications as read
// @route   PATCH /api/notifications/read-all
// @access  Private
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const snapshot = await db.collection('notifications')
      .where('userId', '==', userId)
      .where('isRead', '==', false)
      .get();
      
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, { isRead: true });
    });
    await batch.commit();
    
    res.status(200).json({ message: 'All marked as read' });
  } catch (error) {
    console.error('Mark All Read Error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead
};
