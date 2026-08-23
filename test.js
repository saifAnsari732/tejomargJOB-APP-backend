const { db } = require('./config/firebase'); db.collection('applications').get().then(s => { console.log(s.docs.map(d=>d.data())); process.exit(0); });
