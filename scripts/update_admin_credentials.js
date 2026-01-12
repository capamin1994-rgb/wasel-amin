const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'src/database/database.sqlite');
const db = new sqlite3.Database(dbPath);

const newEmail = 'aman01125062943@gmail.com';
const newPassword = '1994';

async function updateAdmin() {
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Find existing admin or first user
        db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", [], (err, row) => {
            if (err) {
                console.error('Error finding admin:', err);
                process.exit(1);
            }

            if (row) {
                db.run("UPDATE users SET email = ?, password = ? WHERE id = ?", [newEmail, hashedPassword, row.id], function(err) {
                    if (err) {
                        console.error('Error updating admin:', err);
                    } else {
                        console.log(`✅ Admin updated successfully (ID: ${row.id})`);
                    }
                    db.close();
                });
            } else {
                console.log('❌ No admin user found to update.');
                db.close();
            }
        });
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

updateAdmin();
