import { execSync } from 'child_process';
async function run() {
  const hash = execSync('git log -1 --format="%H"').toString().trim();
  console.log(`Checking statuses for commit: ${hash}`);
  const r = await fetch(`https://api.github.com/repos/gschiemann/EDUCMS/commits/${hash}/statuses`, { headers: { 'User-Agent': 'Node' } });
  const data = await r.json();
  if (Array.isArray(data)) {
    console.log(data.map(s => `[${s.state}] ${s.context}: ${s.created_at}`).join('\n'));
    if (data.length === 0) console.log('No statuses yet...');
  } else {
    console.log('Error fetching:', data);
  }
}
run();
