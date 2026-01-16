const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'src', 'database', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('Querying Islamic Reminders Config...');
db.all('SELECT * FROM islamic_reminders_config', [], (err, rows) => {
    if (err) {
        console.error('Error querying islamic_reminders_config:', err);
        return;
    }
    console.log('--- islamic_reminders_config ---');
    console.log(JSON.stringify(rows, null, 2));

    db.all('SELECT * FROM reminder_recipients', [], (err, recipients) => {
        if (err) {
            console.error('Error querying reminder_recipients:', err);
            return;
        }
        console.log('--- reminder_recipients ---');
        console.log(JSON.stringify(recipients, null, 2));

        db.all('SELECT * FROM whatsapp_sessions', [], (err, sessions) => {
            if (err) {
                console.error('Error querying whatsapp_sessions:', err);
                return;
            }
            console.log('--- whatsapp_sessions ---');
            console.log(JSON.stringify(sessions, null, 2));
            db.close();
        });
    });
});
