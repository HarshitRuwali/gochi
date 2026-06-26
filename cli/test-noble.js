import noble from '@abandonware/noble';

console.log('Noble state:', noble.state);

noble.on('stateChange', (state) => {
  console.log('State changed to:', state);
  if (state === 'poweredOn') {
    console.log('Bluetooth is ready');
    process.exit(0);
  } else {
    console.log('Bluetooth not ready:', state);
    process.exit(1);
  }
});

setTimeout(() => {
  console.log('Timeout - noble state never became poweredOn');
  console.log('Final state:', noble.state);
  process.exit(1);
}, 5000);
