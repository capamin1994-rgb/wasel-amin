const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const possiblePaths = [
    path.join(__dirname, 'database.sqlite'),
    path.join(__dirname, 'src', 'database', 'database.sqlite'),
    path.join(__dirname, 'src', 'database', 'app.db'),
    path.join(__dirname, 'data', 'app.db')
];

async function checkDb(dbPath) {
    if (!fs.existsSync(dbPath)) {
        console.log(`❌ File not found: ${dbPath}`);
        return;
    }

    console.log(`\n🔍 Checking DB: ${dbPath}`);
    const db = new sqlite3.Database(dbPath);

    return new Promise((resolve) => {
        db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
            if (err) {
                console.error(`Error listing tables: ${err.message}`);
                db.close();
                resolve();
                return;
            }
            console.log(`Tables: ${tables.map(t => t.name).join(', ')}`);

            if (tables.some(t => t.name === 'islamic_reminders_config')) {
                db.all("SELECT count(*) as count FROM islamic_reminders_config", (err, rows) => {
                    console.log(`Config count: ${rows ? rows[0].count : 'error'}`);
                    db.all("SELECT count(*) as count FROM reminder_recipients", (err, rows) => {
                        console.log(`Recipients count: ${rows ? rows[0].count : 'error'}`);
                        db.close();
                        resolve();
                    });
                });
            } else {
                db.close();
                resolve();
            }
        });
    });
}

async function run() {
    for (const p of possiblePaths) {
        await checkDb(p);
    }
}

run();
