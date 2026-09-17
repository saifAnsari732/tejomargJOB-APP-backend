/* COMMENTED OUT FOR PRODUCTION - DO NOT RUN
const { db } = require('./config/firebase'); async function run() { const s = await db.collection('applications').where('jobId', '==', 'Su1pnI2A6sa7QbVX8L6E').get(); await Promise.all(s.docs.map(d => d.ref.delete())); console.log('Actually deleted ' + s.size); process.exit(0); } run();

*/
