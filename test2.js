const { db } = require('./config/firebase'); db.collection('jobs').doc('Su1pnI2A6sa7QbVX8L6E').get().then(s => { console.log(s.data()); process.exit(0); });
