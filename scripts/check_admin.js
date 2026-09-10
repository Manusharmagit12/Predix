require('../lib/load-env');
const { PgStore } = require('../lib/store-pg');
const { verifyPassword, hashPassword } = require('../lib/auth');

async function main() {
  const db = new PgStore();
  await db.load();
  const u = db.findOne('users', (u) => u.username === 'admin');
  console.log('Admin user found:', u ? { id: u.id, username: u.username, role: u.role, salt: u.salt ? 'yes' : 'no' } : 'none');
  if (u) {
    const ok = verifyPassword('admin1234', u.salt, u.passHash);
    console.log('Password admin1234 matches:', ok);
    if (!ok) {
      console.log('Re-hashing password to admin1234...');
      const { salt, hash } = hashPassword('admin1234');
      u.salt = salt;
      u.passHash = hash;
      db.update('users', u);
      await db.flush();
      console.log('Admin password reset to admin1234.');
    }
  }
  await db.close();
}
main().catch(console.error);
