const http = require('http');
http.get('http://127.0.0.1:3001/restaurantes?limit=24&openOnly=false', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(JSON.parse(data).data.items.length, 'restaurants returned'));
});
