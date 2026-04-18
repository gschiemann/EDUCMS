const fs = require('fs');

let c = fs.readFileSync('apps/api/src/templates/system-presets.ts', 'utf8');

// 1. Update preset-lobby-welcome (Sunshine Academy)
c = c.replace("content: 'Welcome to Our School!'", "content: 'Welcome to Sunshine Academy! ☀️'");
c = c.replace("messages: ['Welcome!']", "messages: ['Welcome back, Sunshine Stars! ⭐', 'Picture day is this Friday!', 'Parent-teacher conferences next Tuesday']");
c = c.replace("name: 'Priority Message'", "name: 'Announcement'");
c = c.replace("message: 'Please remember to sign in at the front desk.'", "title: 'Book Fair starts Monday!', message: 'Come explore hundreds of new books in the library. Bring your reading log!', badgeLabel: '📣 Today\\'s Announcement'");

// 2. Update preset-classroom-daily (Back to School)
c = c.replace("content: 'Good Morning, Class!'", "content: 'Welcome to Mrs. Smith\\'s Class! 🍎'");
c = c.replace("messages: ['Have a great day!']", "messages: ['Reading time at 10:00 AM 📚', 'Recess at 11:30 AM 🏃‍♂️', 'Don\\'t forget your permission slips!']");

// 3. Update preset-cafeteria-menu (Diner Chalkboard)
c = c.replace("messages: ['Enjoy your meal!']", "messages: ['Grab your milk! 🥛', 'Fresh fruit at the salad bar 🥗', 'Please recycle your trays ♻️']");
c = c.replace("html: '<h2 style=\"color:#FFF;\">Today\\'s Special</h2><p>Spaghetti & Meatballs</p>'", "html: '<h2 style=\"color:#FFF;\">Today\\'s Special</h2><p style=\"font-size: 24px; color: #FFD700;\">🍔 Classic Cheeseburger</p><p>Served with sweet potato fries & side salad</p>'");

// 4. Update library-quiet-zone
c = c.replace("messages: ['Shh... quiet zone']", "messages: ['📚 New Arrivals Section Updated!', 'Join the Summer Reading Challenge 🌟', 'Return books by Friday to avoid fines']");
c = c.replace("html: '<h2>Featured Book</h2><p>Harry Potter</p>'", "html: '<h2 style=\"color:#4A5568;\">Book of the Month</h2><p style=\"font-size: 24px; color: #2D3748; font-weight: bold;\">📖 Charlotte\\'s Web</p><p style=\"color: #718096;\">By E.B. White</p>'");

// 5. Update stem-science-lab
c = c.replace("messages: ['Safety glasses required']", "messages: ['🥽 Safety goggles must be worn at all times', 'Wash hands after handling specimens', 'Science Fair projects due April 15th!']");

// 6. Update music-room-arts
c = c.replace("messages: ['Practice makes perfect!']", "messages: ['🎵 Spring Concert rehearsals start next week', 'Please wipe down instruments after use', 'Jazz Band meets Thursday at 3:30 PM']");

fs.writeFileSync('apps/api/src/templates/system-presets.ts', c);
