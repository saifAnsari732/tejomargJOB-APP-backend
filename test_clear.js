const { db } = require('./config/firebase'); db.collection('applications').get().then(s => { s.docs.forEach(d => d.ref.delete()); console.log('Deleted all ' + s.size); process.exit(0); });
