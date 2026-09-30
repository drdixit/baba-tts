import { isUserBanned, getBannedUsers } from '../src/backend/db.js';
console.log('Banned users:', getBannedUsers());
console.log('Is test user banned?', isUserBanned('sim-user'));
