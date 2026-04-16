async function run() {
  const r = await fetch('https://api.github.com/repos/gschiemann/EDUCMS/commits/ec29596ba65af5ee6180ef1ec36a7fd5aed7e7f9/statuses', { headers: { 'User-Agent': 'Node' } });
  const data = await r.json();
  if (Array.isArray(data)) {
    console.log(data.map(s => `[${s.state}] ${s.context}: ${s.created_at}`).join('\n'));
  }
}
run();
