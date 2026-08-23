const { db } = require('../config/firebase');
const sendNotification = require('../utils/sendNotification');

const socketHandler = (io) => {
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // User joins their own personal room (using userId) to receive direct events
    socket.on('setup', (userData) => {
      if (userData && (userData._id || userData.id)) {
        socket.join(userData._id || userData.id);
        socket.emit('connected');
      }
    });

    // Join a specific chat room
    socket.on('join chat', (room) => {
      socket.join(room);
      console.log(`User joined room: ${room}`);
    });

    // Handle new message
    socket.on('new message', async (newMessageRecv) => {
      try {
        const chatSnap = await db.collection('chats').doc(newMessageRecv.chatId).get();
        if (!chatSnap.exists) return;

        const chat = chatSnap.data();

        // Fetch sender name
        const senderSnap = await db.collection('users').doc(newMessageRecv.senderId).get();
        let senderName = 'Someone';
        if (senderSnap.exists && senderSnap.data().role === 'candidate') {
           const profileSnap = await db.collection('candidateProfiles').doc(newMessageRecv.senderId).get();
           if (profileSnap.exists && profileSnap.data().name) senderName = profileSnap.data().name;
        } else if (senderSnap.exists && senderSnap.data().role === 'employer') {
           const profileSnap = await db.collection('employerProfiles').doc(newMessageRecv.senderId).get();
           if (profileSnap.exists && profileSnap.data().companyName) senderName = profileSnap.data().companyName;
        }

        chat.participants.forEach(async (userId) => {
          if (userId !== newMessageRecv.senderId) {
            // Emit to the receiver's personal room for real-time UI update
            socket.in(userId).emit('message received', newMessageRecv);

            // Send a push notification (works for both background and foreground)
            await sendNotification(
              userId,
              `New message from ${senderName}`,
              newMessageRecv.text,
              { type: 'chat', chatId: newMessageRecv.chatId }
            );
          }
        });
      } catch (error) {
        console.error('Socket message error:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });
};

module.exports = socketHandler;
