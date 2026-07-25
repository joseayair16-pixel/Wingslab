const net = require('net');

const client = new net.Socket();
client.connect(5433, '127.0.0.1', () => {
    console.log('Connected to port 5433');
    client.write('test');
});

client.on('data', (data) => {
    console.log('Received: ' + data);
    client.destroy();
});

client.on('error', (err) => {
    console.log('Error: ' + err.message);
});

client.on('close', () => {
    console.log('Connection closed');
});
