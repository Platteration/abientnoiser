const test = require('node:test');
const assert = require('node:assert/strict');
const { hostName, hostGate, MAX_LOGGED, MAX_NAME, RESCAN_MS } = require('../scripts/hosts.js');

/** A gate with the operating system stood in for: the interface list can change between
 *  reads, the clock is ours, and the log is collected. */
function gate(opts = {}) {
  const lists = opts.interfaces || [['10.0.0.5']];
  let reads = 0;
  const logged = [];
  let t = 0;
  const g = hostGate({
    host: opts.host || '0.0.0.0',
    allowedHost: opts.allowedHost,
    interfaces: () => { const list = lists[Math.min(reads, lists.length - 1)]; reads++; return { eth0: list.map((address) => ({ address, family: address.includes(':') ? 'IPv6' : 'IPv4', internal: false })) }; },
    hostname: () => opts.hostname || 'Laptop',
    log: (line) => logged.push(line),
    now: () => t,
  });
  return { allowed: g, logged, reads: () => reads, tick: (ms) => { t += ms; } };
}

test('hostName drops a port but never a bare IPv6 literal\'s last group', () => {
  assert.equal(hostName('localhost:5173'), 'localhost');
  assert.equal(hostName('[::1]:5173'), '[::1]');
  assert.equal(hostName('::1'), '::1');
  assert.equal(hostName(' Laptop.LOCAL:5173 '), 'laptop.local');
  assert.equal(hostName(undefined), '');
  // Node hands over a string or nothing, so these are the shapes nothing produces — and
  // String({toString: 'x'}) throws, which in a request handler is a dead dev server.
  assert.equal(hostName({ toString: 'x' }), '', 'a value that is not a string is no name at all');
  assert.equal(hostName(['a.example', 'b.example']), '', 'and a list of names is not one either');
});

test('on loopback, only the loopback names and ALLOWED_HOST are answered', () => {
  for (const bound of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
    assert.equal(gate({ host: bound }).allowed('10.0.0.5'), false, `bound to ${bound} is a loopback bind`);
  }
  const { allowed, logged } = gate({ host: '127.0.0.1', allowedHost: 'front.example:8080, other.example' });
  for (const h of ['localhost', 'LOCALHOST:5173', '127.0.0.1:5173', '[::1]:5173', '::1', undefined, '', 'front.example', 'front.example:9', 'other.example:5173']) {
    assert.equal(allowed(h), true, `${h} is answered`);
  }
  for (const h of ['evil.example', 'localhost.evil.example', '10.0.0.5:5173', 'laptop', 'laptop.local:5173', 'front.example.evil']) {
    assert.equal(allowed(h), false, `${h} is refused`);
  }
  assert.match(logged[0], /refused Host "evil.example"/);
  assert.match(logged[0], /ALLOWED_HOST=evil.example/, 'the refusal says how to allow the name');
  assert.match(logged[0], /HOST=0.0.0.0/, 'and, on loopback, how to answer to this machine\'s own names');
});

test('off loopback, this machine\'s own names are answered as well', () => {
  const { allowed, logged } = gate({ host: '0.0.0.0', interfaces: [['192.168.1.20', 'fe80::1']], hostname: 'Laptop', allowedHost: 'front.example' });
  for (const h of [
    '0.0.0.0:5173', '192.168.1.20', '192.168.1.20:5173', '[192.168.1.20]:5173',
    'fe80::1', '[fe80::1]:5173', '[FE80::1]',
    'laptop', 'Laptop:5173', 'laptop.local', 'LAPTOP.local:5173',
    'anything.local', 'phone-typed-this.local:5173',
    'front.example:5173', 'localhost:5173', '[::1]:5173', undefined,
  ]) assert.equal(allowed(h), true, `${h} is answered`);
  for (const h of ['evil.example', 'evil.local.example', 'local', '192.168.1.21', 'laptop.lan', 'laptop.localdomain']) {
    assert.equal(allowed(h), false, `${h} is refused`);
  }
  assert.doesNotMatch(logged[0], /HOST=0.0.0.0/, 'the refusal does not offer a mode this server is already in');
});

// The Wi-Fi a phone is on may come up after `npm start`; its address is one the phone will
// type, so a miss reads the interfaces again before refusing — and not per request.
test('a miss re-reads the interfaces, at most once a second', () => {
  const { allowed, reads, tick } = gate({ interfaces: [['10.0.0.5'], ['10.0.0.5', '10.0.0.9'], ['10.0.0.5', '10.0.0.9', '10.0.0.13']] });
  assert.equal(reads(), 1, 'read once at the start');
  assert.equal(allowed('10.0.0.5:5173'), true);
  assert.equal(reads(), 1, 'a hit reads nothing');
  tick(RESCAN_MS);
  assert.equal(allowed('10.0.0.9:5173'), true, 'an address that came up since the start is answered');
  assert.equal(reads(), 2);
  assert.equal(allowed('10.0.0.13:5173'), false, 'but the next miss within the throttle does not read again');
  assert.equal(reads(), 2);
  tick(RESCAN_MS);
  assert.equal(allowed('10.0.0.13:5173'), true);
  assert.equal(reads(), 3);
  assert.equal(allowed('evil.example'), false, 'and a name no interface has stays refused');
});

test('on loopback a miss never reads the interfaces: their addresses are not answered there', () => {
  const { allowed, reads, tick } = gate({ host: '127.0.0.1', interfaces: [['10.0.0.5'], ['10.0.0.5', '10.0.0.9']] });
  assert.equal(reads(), 0);
  tick(RESCAN_MS);
  assert.equal(allowed('10.0.0.9:5173'), false);
  assert.equal(reads(), 0);
});

test('a refused name is logged once, and no more than a bounded number of names', () => {
  const { allowed, logged } = gate();
  allowed('evil.example'); allowed('evil.example:5173'); allowed('EVIL.example');
  assert.equal(logged.length, 1, 'one line for one name, whatever its port or case');
  allowed('other.example');
  assert.equal(logged.length, 2);
  // A name is whatever the client typed, so it is printed cut and without the hint, which
  // would otherwise be a cut name that does not work when it is pasted.
  allowed('x'.repeat(5000) + '.example');
  assert.equal(logged.length, 3);
  assert.ok(logged[2].length < MAX_NAME + 200, `a long name is cut, not printed whole: ${logged[2].length} chars`);
  assert.doesNotMatch(logged[2], /ALLOWED_HOST=/, 'and a name too long to be one is not offered as one');
  assert.match(logged[1], /ALLOWED_HOST=other.example/, 'while a plausible one is');
  for (let i = 0; i < MAX_LOGGED + 50; i++) allowed(`n${i}.example`);
  assert.equal(logged.length, MAX_LOGGED, 'a client minting names cannot fill the terminal');
});
