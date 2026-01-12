const { init, db } = require('./src/database/db');

async function checkReminders() {
    try {
        await init();
        console.log('--- Reminders Config ---');
        const configs = await db.all('SELECT id, user_id, session_id, enabled, timezone FROM islamic_reminders_config');
        console.log(JSON.stringify(configs, null, 2));

        console.log('\n--- Recipients ---');
        const recipients = await db.all('SELECT id, config_id, name, type, enabled FROM reminder_recipients');
        console.log(JSON.stringify(recipients, null, 2));

        console.log('\n--- Adhkar Settings ---');
        const adhkar = await db.all('SELECT * FROM adhkar_settings');
        console.log(JSON.stringify(adhkar, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkReminders();
