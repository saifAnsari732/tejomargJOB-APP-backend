/* COMMENTED OUT FOR PRODUCTION - DO NOT RUN
const { db } = require('./config/firebase'); db.collection('applications').get().then(s => { console.log(s.docs.map(d => ({id: d.id, ...d.data()}))); process.exit(0); });

*/
