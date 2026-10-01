/* Which Host names the dev server answers to.
 * Binding to loopback stops a network peer; it does not stop a browser that has been
 * told an attacker's own name resolves to 127.0.0.1 (DNS rebinding). The rebound request
 * still carries that name in Host, so the gate below is what keeps a visited web page
 * out of the checkout. Kept apart from the server, with the OS reads injectable, because
 * the one rule a test cannot stage against a real server — an interface that comes up
 * after `npm start` — is the one a phone will hit. */
const os = require('os');

/**
 * The name in a Host header, without its port. A bare IPv6 literal carries no
 * port — RFC 7230 requires brackets for that — so stripping `:\d+$` from one
 * turned `::1` into `:` and made that entry unmatchable. Only a string is a name:
 * Node hands over `req.headers.host` as a string or nothing (a second Host header is
 * dropped by the parser, so this is never a list), and `String(x)` throws outright on
 * an object whose `toString` is not callable — a coercion is not worth a dead server.
 */
function hostName(raw) {
  if (typeof raw !== 'string') return '';
  const h = raw.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1) || h; // bracketed IPv6: the port is outside
  return h.indexOf(':') === h.lastIndexOf(':') ? h.replace(/:\d+$/, '') : h;
}

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1'];
/** Refusals are logged once per name, and no more names than this are remembered: a
 *  client can mint a new name per request, and the log is a hint, not a record. The names
 *  are kept whole so two long ones are still told apart; Node caps the whole header block
 *  at 16 KB, so that set is bounded in bytes as well as in entries. */
const MAX_LOGGED = 100;
/** Longer than any name a developer types, so a name past it is a probe: it is printed
 *  cut, and without the "set ALLOWED_HOST=" hint, which would be a cut name that would
 *  not work if it were pasted. */
const MAX_NAME = 100;
/** A miss re-reads the interfaces at most this often, so a client cannot make the
 *  server scan them per request. */
const RESCAN_MS = 1000;

/**
 * A gate over the Host header for a server bound to `host`.
 * Loopback names always, and ALLOWED_HOST, a comma-separated list for anyone who
 * fronts this with something else — a port forward, a tunnel — normalised the same way,
 * so `dev.example.com:8080` is the name it looks like and not a value nothing matches.
 * Bound off loopback for phone testing, the phone types one of this machine's own names,
 * so those are answered too: the bound address, every interface address in both
 * spellings (hostName keeps the brackets of a bracketed IPv6 literal, and drops a port
 * either way), the hostname, and any name under .local — that is mDNS (RFC 6762), which
 * no internet DNS can point at 127.0.0.1, and which covers `<hostname>.local`, the name a
 * phone is actually given for this machine, without a second entry nothing would reach.
 * An interface that came up after the start — the Wi-Fi the phone is on, a hotspot
 * switched on for it — is read again on a miss, before the miss is refused.
 * A request with no Host at all is answered: a browser always sends one and a page
 * cannot set it, so the only clients that reach here without one are HTTP/1.0 probes.
 * @returns {(raw: unknown) => boolean} true when the request may be served
 */
function hostGate({ host, allowedHost = '', interfaces = os.networkInterfaces, hostname = os.hostname, log = console.error, now = Date.now } = {}) {
  const lan = !LOOPBACK.includes(hostName(host));
  const names = new Set(LOOPBACK);
  for (const entry of (typeof allowedHost === 'string' ? allowedHost : '').split(',')) {
    const name = hostName(entry);
    if (name) names.add(name);
  }

  // Both spellings of an address, so `[fe80::1]:5173` and `fe80::1` are the same name here.
  const address = (a) => {
    const name = hostName(a);
    if (name) names.add(name).add(hostName(`[${a}]`));
  };
  let scanned = -Infinity;
  const readOwn = () => {
    scanned = now();
    address(host);
    for (const list of Object.values(interfaces() || {})) for (const { address: a } of list || []) if (a) address(a);
    const h = hostName(hostname());
    if (h) names.add(h); // `<hostname>.local` needs no entry: every .local name is answered below
  };
  if (lan) readOwn();

  const refused = new Set();
  return function allowed(raw) {
    const name = hostName(raw);
    if (!name || names.has(name)) return true;
    if (lan) {
      if (name.endsWith('.local')) return true;
      if (now() - scanned >= RESCAN_MS) readOwn();
      if (names.has(name)) return true;
    }
    if (refused.size < MAX_LOGGED && !refused.has(name)) {
      refused.add(name);
      const long = name.length > MAX_NAME;
      const shown = JSON.stringify(long ? `${name.slice(0, MAX_NAME)}…` : name);
      const how = lan ? '' : ' (or HOST=0.0.0.0 to answer to this machine\'s own names)';
      log(`Ambient Noiser: refused Host ${shown} — not one of this server's names.${long ? '' : ` If it should be, set ALLOWED_HOST=${name}${how}.`}`);
    }
    return false;
  };
}

module.exports = { hostName, hostGate, LOOPBACK, MAX_LOGGED, MAX_NAME, RESCAN_MS };
