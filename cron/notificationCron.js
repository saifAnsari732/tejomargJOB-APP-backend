const cron = require('node-cron');
const { db } = require('../config/firebase');
const sendNotification = require('../utils/sendNotification');

// Schedule tasks to be run on the server.
// For example: '0 10 * * *' runs every day at 10:00 AM.
// We will use a faster schedule for testing purposes if needed, but normally use daily.

const initCronJobs = () => {
  console.log('Initializing Automated Notification Cron Jobs...');

  // 1. Profile Completion Reminder (Runs daily at 10:00 AM)
  cron.schedule('0 10 * * *', async () => {
    console.log('Running Profile Completion Reminder Job...');
    try {
      const snapshot = await db.collection('candidateProfiles').get();
      for (let doc of snapshot.docs) {
        const profile = doc.data();
        if (profile.profileCompletionPercent < 100) {
          await sendNotification(
            doc.id,
            'Complete Your Profile!',
            'Complete your profile to 100% to get 3x more job offers from top companies.',
            { type: 'reminder', action: 'profile' }
          );
        }
      }
    } catch (error) {
      console.error('Error in Profile Reminder Cron:', error);
    }
  });

  // 2. Pending Applications Reminder for Employers (Runs daily at 11:00 AM)
  cron.schedule('0 11 * * *', async () => {
    console.log('Running Pending Applications Reminder Job...');
    try {
      // Find all pending applications
      const applicationsSnap = await db.collection('applications').where('status', '==', 'pending').get();
      
      const employersToNotify = new Set();
      const jobCache = {};

      for (let doc of applicationsSnap.docs) {
        const app = doc.data();
        
        // Find which employer owns this job
        if (!jobCache[app.jobId]) {
          const jobSnap = await db.collection('jobs').doc(app.jobId).get();
          if (jobSnap.exists) {
            jobCache[app.jobId] = jobSnap.data().employerId;
          }
        }

        const employerId = jobCache[app.jobId];
        if (employerId) {
          employersToNotify.add(employerId);
        }
      }

      for (let empId of employersToNotify) {
        await sendNotification(
          empId,
          'Pending Applications Waiting!',
          'You have pending candidate applications. Review them before top talent gets hired elsewhere!',
          { type: 'reminder', action: 'applications' }
        );
      }
    } catch (error) {
      console.error('Error in Pending Applications Cron:', error);
    }
  });

  // 3. General New Jobs Reminder for Candidates (Runs daily at 12:00 PM)
  cron.schedule('0 12 * * *', async () => {
    console.log('Running General New Jobs Reminder Job...');
    try {
      // Fetch all candidate users
      const usersSnap = await db.collection('users').where('role', '==', 'candidate').get();
      
      for (let doc of usersSnap.docs) {
        await sendNotification(
          doc.id,
          'New Jobs Waiting for You! 🚀',
          'Check out the latest job openings matching your skills on Tejomarg.',
          { type: 'reminder', action: 'jobs' }
        );
      }
    } catch (error) {
      console.error('Error in General Jobs Reminder Cron:', error);
    }
  });
};

module.exports = { initCronJobs };
