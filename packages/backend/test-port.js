const net = require('net');
const client = net.createConnection({ port: 5433, host: '127.0.0.1' }, () => {
  console.log('PORT 5433 IS OPEN!');
  process.exit(0);
});
client.on('error', (err) => {
  console.error('PORT 5433 IS CLOSED:', err.message);
  process.exit(1);
});
