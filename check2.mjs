async function run() {
  const r = await fetch('https://api.github.com/repos/gschiemann/EDUCMS/commits/959673a/statuses', { headers: { 'User-Agent': 'Node' } });
  const data = await r.json();
  if (Array.isArray(data)) {
    console.log(data.map(s => `[${s.state}] ${s.context}: ${s.created_at}`).join('\n'));
  }
}
run();
