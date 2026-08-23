const { db } = require('../config/firebase');
const sendNotification = require('../utils/sendNotification');

// @desc    Get user's chats
// @route   GET /api/chat
// @access  Private
const getUserChats = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    const snapshot = await db.collection('chats')
      .where('participants', 'array-contains', userId)
      .get();

    let chats = [];
    for (let doc of snapshot.docs) {
      const chat = { _id: doc.id, ...doc.data() };
      
      // Populate participants info
      const populatedParticipants = [];
      for (const pId of chat.participants) {
        const userSnap = await db.collection('users').doc(pId).get();
        if (userSnap.exists) {
           const ud = userSnap.data();
           populatedParticipants.push({ _id: pId, phone: ud.phone, role: ud.role, name: ud.name || 'User' });
        }
      }
      chat.participants = populatedParticipants;

      // Populate jobId if exists
      if (chat.jobId) {
        const jobSnap = await db.collection('jobs').doc(chat.jobId).get();
        if (jobSnap.exists) {
          chat.jobId = { _id: jobSnap.id, title: jobSnap.data().title };
        }
      }

      chats.push(chat);
    }

    chats.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    res.status(200).json(chats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get chat messages
// @route   GET /api/chat/:chatId/messages
// @access  Private
const getChatMessages = async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const userId = req.user._id || req.user.id;

    const chatSnap = await db.collection('chats').doc(chatId).get();
    if (!chatSnap.exists) return res.status(404).json({ message: 'Chat not found' });

    if (!chatSnap.data().participants.includes(userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const messagesSnap = await db.collection('messages')
      .where('chatId', '==', chatId)
      .orderBy('createdAt', 'asc')
      .get();

    const messages = messagesSnap.docs.map(doc => ({ _id: doc.id, ...doc.data() }));

    res.status(200).json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Send a message (REST API fallback/init)
// @route   POST /api/chat/message
// @access  Private
const sendMessage = async (req, res) => {
  try {
    const { receiverId, jobId, text, chatId } = req.body;
    const senderId = req.user._id || req.user.id;

    let chatDocRef = null;
    let chatExists = false;

    if (chatId && !chatId.startsWith('new_')) {
      const existingSnap = await db.collection('chats').doc(chatId).get();
      if (existingSnap.exists) {
        chatExists = true;
        chatDocRef = existingSnap.ref;
      }
    } else {
      // Find existing chat by participants
      const chatsSnap = await db.collection('chats')
        .where('participants', 'array-contains', senderId)
        .get();
        
      for (let doc of chatsSnap.docs) {
        const data = doc.data();
        if (data.participants.includes(receiverId) && (data.jobId === jobId || (!data.jobId && !jobId))) {
          chatExists = true;
          chatDocRef = doc.ref;
          break;
        }
      }
    }

    if (!chatExists) {
      chatDocRef = await db.collection('chats').add({
        participants: [senderId, receiverId],
        jobId: jobId || null,
        lastMessage: text,
        lastMessageAt: Date.now()
      });
    } else {
      await chatDocRef.update({
        lastMessage: text,
        lastMessageAt: Date.now()
      });
    }

    const messageData = {
      chatId: chatDocRef.id,
      senderId,
      text,
      createdAt: Date.now()
    };

    const msgRef = await db.collection('messages').add(messageData);

    // Send push notification to the receiver
    // Fetch sender phone or name to show in the notification
    const senderSnap = await db.collection('users').doc(senderId).get();
    let senderName = 'User';
    if (senderSnap.exists && senderSnap.data().name) {
      senderName = senderSnap.data().name;
    }
    
    await sendNotification(
      receiverId, 
      `New message from ${senderName}`, 
      text, 
      { type: 'chat', chatId: chatDocRef.id }
    );

    res.status(201).json({ _id: msgRef.id, ...messageData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getUserChats,
  getChatMessages,
  sendMessage
};
