async function run() {
  const r = await fetch('https://api.github.com/repos/gschiemann/EDUCMS/commits/ec29596ba65af5ee6180ef1ec36a7fd5aed7e7f9/statuses', { headers: { 'User-Agent': 'Node' } });
  const data = await r.json();
  if (Array.isArray(data)) {
    console.log(data.map(s => `[${s.state}] ${s.context}: ${s.description} (${s.target_url})`).join('\n'));
    if (data.length === 0) console.log('Empty statuses array. Railway might not be syncing statuses.');
  } else {
    console.log('Error:', data);
  }
}
run();
