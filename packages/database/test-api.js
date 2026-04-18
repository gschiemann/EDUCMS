const http = require('http');
http.get('http://localhost:8080/api/v1/templates?includeSystem=true', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      const msh = parsed.find(t => t.id === '092408f5-bff3-4895-a47d-df1e1267d491');
      console.log('API returned config type:', typeof msh.zones[0].defaultConfig);
      console.log('API returned config:', msh.zones[0].defaultConfig);
    } catch(e) { console.log('error', e.message); }
  });
});
