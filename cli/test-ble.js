import { request } from 'node:http';

const req = request(
  {
    socketPath: '/Users/harshitruwali/.tamagotchi/daemon.sock',
    method: 'POST',
    path: '/ble/connect',
    headers: { 'Content-Type': 'application/json' },
  },
  (res) => {
    let buf = '';
    res.on('data', (c) => (buf += c));
    res.on('end', () => {
      console.log('Response:', buf);
      process.exit(0);
    });
  }
);

req.on('error', (e) => {
  console.error('Error:', e.message);
  process.exit(1);
});

req.write(JSON.stringify({ device: 'Gochi-EE74' }));
req.end();

setTimeout(() => {
  console.log('Timeout - no response after 10s');
  process.exit(1);
}, 10000);
