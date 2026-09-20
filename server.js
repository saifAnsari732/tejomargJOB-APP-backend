const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

require('./config/firebase'); // Initialize Firebase
const socketHandler = require('./sockets/socketHandler');
const { initCronJobs } = require('./cron/notificationCron');

const authRoutes = require('./routes/authRoutes');
const candidateRoutes = require('./routes/candidateRoutes');
const employerRoutes = require('./routes/employerRoutes');
const jobRoutes = require('./routes/jobRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const chatRoutes = require('./routes/chatRoutes');
const aiRoutes = require('./routes/aiRoutes'); 
const notificationRoutes = require('./routes/notificationRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const couponRoutes = require('./routes/couponRoutes');
const uploadRoutes = require('./routes/uploadRoutes');

const app = express(); 
const server = http.createServer(app);
 
const ALLOWED_ORIGINS = [
  'https://tejomargjob-app-backend.onrender.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://localhost:8081',
  'http://localhost:19006',
  /\.vercel\.app$/,
  /^exp:\/\//,
];

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
}); 
  
// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow mobile apps (no origin) and whitelisted web origins
    if (!origin || ALLOWED_ORIGINS.some(o => typeof o === 'string' ? o === origin : o.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes 
app.use('/api/auth', authRoutes);
app.use('/api/candidate', candidateRoutes);
app.use('/api/employer', employerRoutes);
app.use('/api/employer/jobs', jobRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => {
  res.send('JobConnect API is running...');
});

// Socket.io
socketHandler(io);

// Error Handling (Basic)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  initCronJobs(); // Start automated notification cron jobs
});
