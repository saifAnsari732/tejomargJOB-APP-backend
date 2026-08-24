const { Expo } = require('expo-server-sdk');
const { db } = require('../config/firebase');

const expo = new Expo();

/**
 * Send a push notification to a specific user and save it to the DB
 * @param {string} userId - The ID of the user to send the notification to
 * @param {string} title - The notification title
 * @param {string} body - The notification body
 * @param {object} data - Optional extra data payload
 */
const sendNotification = async (userId, title, body, data = {}) => {
  try {
    // 1. Save to Database for the Notifications Screen
    await db.collection('notifications').add({
      userId,
      title,
      message: body,
      type: data.type || 'system',
      isRead: false,
      data,
      createdAt: new Date().toISOString()
    });

    // 2. Fetch user from Firestore to get their pushToken
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return;

    const user = userDoc.data();
    if (!user.pushToken) {
      console.log(`User ${userId} does not have a push token.`);
      return;
    }

    // Role check to prevent mixed notifications if user switched roles
    if (data.targetRole && user.role !== data.targetRole) {
      console.log(`Skipping notification for ${userId}: target role is ${data.targetRole} but user is ${user.role}`);
      return;
    }

    if (!Expo.isExpoPushToken(user.pushToken)) {
      console.error(`Push token ${user.pushToken} is not a valid Expo push token`);
      return;
    }

    // 3. Construct and send the message
    const messages = [{
      to: user.pushToken,
      sound: 'default',
      title,
      body,
      data,
    }];

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        console.error('Error sending push chunk:', error);
      }
    }
    
  } catch (error) {
    console.error('sendNotification Error:', error);
  }
};

module.exports = sendNotification;
