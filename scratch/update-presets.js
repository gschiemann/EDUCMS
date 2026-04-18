const fs = require('fs');

let c = fs.readFileSync('apps/api/src/templates/system-presets.ts', 'utf8');

// Update Library
c = c.replace(/bgColor: '#F5F0EB',\s+zones/g, "bgGradient: LIBRARY_QUIET_BG,\n    zones");
c = c.replace(
  /defaultConfig: \{\s+content: 'Media Center[\\s\\S]*?bgColor: 'transparent',\s+\},/g,
  "defaultConfig: {\n          theme: 'library-quiet',\n          content: 'Media Center — Please keep voices low 🤫',\n          fontSize: 22,\n          alignment: 'center',\n          color: '#3E2723',\n          bgColor: 'transparent',\n        },"
);
c = c.replace(/defaultConfig: \{ format: '12h'/g, "defaultConfig: { theme: 'library-quiet', format: '12h'");
c = c.replace(/defaultConfig: \{ fitMode: 'contain'/g, "defaultConfig: { theme: 'library-quiet', fitMode: 'contain'");
c = c.replace(
  /defaultConfig: \{\s+html: '<h3 style="color:#3E2723;">Library Hours[\\s\\S]*?\},/g,
  "defaultConfig: {\n          theme: 'library-quiet',\n          html: '<h3 style=\"color:#3E2723;\">Library Hours</h3><p>Mon—Fri: 7:30 AM — 4:00 PM</p><p>Quiet Study: 8:00 — 11:00 AM</p><p>Open Reading: 11:00 AM — 3:00 PM</p>',\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+meals: \[\s+\{ label: 'Today'[\\s\\S]*?\},/g,
  "defaultConfig: {\n          theme: 'library-quiet',\n          meals: [\n            { label: 'Today', items: ['Update in settings'] },\n          ],\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+speed: 'slow',\s+messages: \[\s+'New arrivals[\\s\\S]*?\},/g,
  "defaultConfig: {\n          theme: 'library-quiet',\n          speed: 'slow',\n          messages: [\n            'New arrivals on the display shelf near the entrance',\n            'Book Club meets Wednesdays at 3:15 PM — all grades welcome',\n            'Overdue books? Return them to the front desk — no questions asked',\n          ],\n        },"
);

// Update Music
c = c.replace(/bgGradient: 'linear-gradient\(135deg, #1A0533 0%, #2D1B5E 50%, #0D2137 100%\)',/g, "bgGradient: MUSIC_ARTS_BG,");
c = c.replace(
  /defaultConfig: \{\s+content: 'Music & Arts[\\s\\S]*?bgColor: 'transparent',\s+\},/g,
  "defaultConfig: {\n          theme: 'music-arts',\n          content: 'Music & Arts — Practice Makes Perfect 🎵',\n          fontSize: 26,\n          alignment: 'center',\n          color: '#E040FB',\n          bgColor: 'transparent',\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+label: 'Spring Concert in',[\\s\\S]*?showHours: false,\s+\},/g,
  "defaultConfig: {\n          theme: 'music-arts',\n          label: 'Spring Concert in',\n          targetDate: '',\n          showDays: true,\n          showHours: false,\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+html: '<h3 style="color:#E040FB;">Rehearsal[\\s\\S]*?\},/g,
  "defaultConfig: {\n          theme: 'music-arts',\n          html: '<h3 style=\"color:#E040FB;\">Rehearsal Schedule</h3><p style=\"color:#fff;\">Monday: Band 7:00—8:00 AM</p><p style=\"color:#fff;\">Tuesday: Choir 3:15—4:30 PM</p><p style=\"color:#fff;\">Thursday: Orchestra 3:15—5:00 PM</p><p style=\"color:#fff;\">Update with current schedule</p>',\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+staffName: 'Featured Artist',[\\s\\S]*?rotateIntervalMs: 20000,\s+\},/g,
  "defaultConfig: {\n          theme: 'music-arts',\n          staffName: 'Featured Artist',\n          role: 'Student of the Month',\n          bio: 'Outstanding dedication to our music program. Congratulations!',\n          rotateIntervalMs: 20000,\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+speed: 'slow',\s+messages: \[\s+'All-State auditions[\\s\\S]*?\},/g,
  "defaultConfig: {\n          theme: 'music-arts',\n          speed: 'slow',\n          messages: [\n            'All-State auditions — see Mr. Rivera for details',\n            'Art gallery submissions due by the 15th',\n            'Spring musical rehearsals begin next week — check the schedule',\n          ],\n        },"
);

// Update STEM
c = c.replace(/bgGradient: 'linear-gradient\(160deg, #0A1628 0%, #0D3349 55%, #0A1628 100%\)',/g, "bgGradient: STEM_LAB_BG,");
c = c.replace(
  /defaultConfig: \{\s+content: 'STEM Lab[\\s\\S]*?bgColor: 'transparent',\s+\},/g,
  "defaultConfig: {\n          theme: 'stem-science',\n          content: 'STEM Lab — Think. Build. Discover. 🚀',\n          fontSize: 26,\n          alignment: 'center',\n          color: '#00E5FF',\n          bgColor: 'transparent',\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+label: 'Science Fair Deadline',[\\s\\S]*?showHours: true,\s+\},/g,
  "defaultConfig: {\n          theme: 'stem-science',\n          label: 'Science Fair Deadline',\n          targetDate: '',\n          showDays: true,\n          showHours: true,\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+html: '<h2 style="color:#00E5FF;">Fact of the Day[\\s\\S]*?\},/g,
  "defaultConfig: {\n          theme: 'stem-science',\n          html: '<h2 style=\"color:#00E5FF;\">Fact of the Day</h2><p style=\"color:#E0F7FA;font-size:1.1rem;\">The human body contains approximately 37 trillion cells.</p><br><p style=\"color:#80DEEA;\">Update daily with a new science or STEM fact.</p>',\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+transitionEffect: 'fade',[\\s\\S]*?fitMode: 'cover',\s+\},/g,
  "defaultConfig: {\n          theme: 'stem-science',\n          transitionEffect: 'fade',\n          intervalMs: 7000,\n          fitMode: 'cover',\n        },"
);
c = c.replace(
  /defaultConfig: \{\s+speed: 'slow',\s+messages: \[\s+'⚠️ Safety goggles[\\s\\S]*?\},/g,
  "defaultConfig: {\n          theme: 'stem-science',\n          speed: 'slow',\n          messages: [\n            '⚠️ Safety goggles required during all lab activities',\n            'No food or drink in the lab at any time',\n            'Report spills immediately to the teacher',\n            'Wash hands after handling any lab materials',\n          ],\n        },"
);

fs.writeFileSync('apps/api/src/templates/system-presets.ts', c);
console.log('done');
