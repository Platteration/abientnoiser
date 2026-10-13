/* The site on real web servers. test/website.test.js reads deploy/nginx.conf and .htaccess and
 * holds what they say equal to _headers; only a server shows what a file does. So this loads
 * deploy/nginx.conf into the nginx installed here and the built site's .htaccess into the Apache
 * installed here, each serving the folder `node scripts/site.js` writes with a checkout's files
 * planted in it, and checks every file of the site answers 200 with every header _headers gives
 * it, and every other address the site's own not-found page. Both files were once found doing
 * something other than what they said: nginx before 1.25.1 (Ubuntu 24.04 ships 1.24) refused the
 * whole of deploy/nginx.conf over `http2 on;`, and Apache sent no HSTS behind a proxy that ended
 * TLS, because env=HTTPS is set by mod_ssl alone.
 *
 * Needs nginx, Apache as Debian and Ubuntu lay it out (/usr/sbin/apache2, modules in
 * /usr/lib/apache2/modules), openssl and /etc/mime.types; GitHub's ubuntu-24.04 runner has them
 * all. Where one is missing this says so and passes, unless CI is set: skipped there, it would
 * read as passed.
 * Run: npm run test:e2e (after the browser suites), or node test/hosts.smoke.mjs */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const site = require('../scripts/site.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = '/usr/lib/apache2/modules';
const NOT_FOUND = 'Page not found';
/** The site's API, as server/start.mjs answers it with nothing configured: what nginx's
 *  `location ^~ /api/` and an Apache virtual host's ProxyPass hand it every /api/ request for. */
const API_CONFIG = fs.readFileSync(path.join(root, 'api', 'config'), 'utf8').trimEnd();
const API_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

const which = (name, fallback) => spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim() || (fs.existsSync(fallback) ? fallback : null);
const NGINX = which('nginx', '/usr/sbin/nginx');
const APACHE = ['rewrite', 'headers', 'mime', 'dir', 'ssl', 'proxy', 'proxy_http'].every((m) => fs.existsSync(path.join(MODULES, `mod_${m}.so`))) ? which('apache2', '/usr/sbin/apache2') : null;
const OPENSSL = which('openssl', '/usr/bin/openssl');
const missing = [
  ...(NGINX ? [] : ['nginx']),
  ...(APACHE ? [] : [`Apache (apache2, with mod_rewrite, mod_headers, mod_mime, mod_dir, mod_ssl, mod_proxy and mod_proxy_http in ${MODULES})`]),
  ...(OPENSSL ? [] : ['openssl']),
  ...(fs.existsSync('/etc/mime.types') ? [] : ['/etc/mime.types']),
];
if (missing.length) {
  const note = `hosts: not installed here: ${missing.join(', ')}`;
  if (process.env.CI) {
    console.error(`${note}. CI runs this on a runner that has them, so this is a failure.`);
    process.exit(1);
  }
  console.log(`${note}. SKIPPED: the real nginx and Apache were not run; CI runs them.`);
  process.exit(0);
}

/** _headers as [{ pattern, headers }], and what a Netlify-style host sends for a path: every
 *  matching rule's headers, the values of a header two rules set joined. */
const RULES = [];
for (const line of fs.readFileSync(path.join(root, '_headers'), 'utf8').split('\n')) {
  if (!line.trim() || line.trimStart().startsWith('#')) continue;
  if (!/^\s/.test(line)) { RULES.push({ pattern: line.trim(), headers: {} }); continue; }
  const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  RULES[RULES.length - 1].headers[m[1]] = m[2].trim();
}
function want(sitePath) {
  const out = {};
  for (const { pattern, headers } of RULES) {
    if (!(pattern.endsWith('/*') ? sitePath.startsWith(pattern.slice(0, -1)) : sitePath === pattern)) continue;
    for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = Object.hasOwn(out, name.toLowerCase()) ? `${out[name.toLowerCase()]}, ${value}` : value;
  }
  return out;
}
/** The names of the headers `response` does not send as _headers gives them for `sitePath`. */
const wrongHeaders = (response, sitePath) => Object.entries(want(sitePath)).filter(([name, value]) => response.headers[name] !== value).map(([name]) => `${name}: ${response.headers[name]}`);

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
/** One request: status, headers and body. The certificate is this run's own, self-signed. */
const get = (url, headers = {}) => new Promise((resolve, reject) => {
  const req = (url.startsWith('https:') ? https : http).get(url, { headers, rejectUnauthorized: false, agent: false }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on('error', reject);
  req.setTimeout(10000, () => req.destroy(new Error(`${url}: no answer in 10 s`)));
});
async function waitFor(url, log) {
  for (let i = 0; i < 100; i++) {
    try { return await get(url); } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error(`${url} never answered:\n${log()}`);
}

// The site as it would be copied to a server, with the files of a checkout planted beside it:
// none of these may be served. Readable by everyone, since a server started as root reads it as
// an unprivileged user.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'an-hosts-'));
fs.chmodSync(work, 0o755);
const dir = path.join(work, 'site');
site.build(dir, { host: 'apache' });
const PLANTED = {
  'README.md': '# the README\n', '.git/config': '[core]\n', '.git/HEAD': 'ref: refs/heads/main\n',
  'deploy/nginx.conf': 'server {}\n', '_headers': '/*\n', 'package.json': '{}\n', 'test/website.test.js': '//\n',
  '.env': 'SECRET=1\n', 'js/app.js.map': '{}\n', 'server/start.mjs': '//\n', 'api/secret.json': '{"planted":true}\n',
};
for (const [file, text] of Object.entries(PLANTED)) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}
spawnSync('chmod', ['-R', 'a+rX', work]);
const asRoot = process.getuid?.() === 0;
const cert = path.join(work, 'cert.pem');
const key = path.join(work, 'key.pem');
spawnSync(OPENSSL, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
fs.chmodSync(key, 0o644);

/** Every file of the site, and the page at its root. */
const SERVED = ['/', ...site.siteFiles().map((f) => `/${f}`)];
/** The planted files, the hosting configuration and the folders: the not-found page. */
const REFUSED = [...Object.keys(PLANTED).map((f) => `/${f}`), '/.htaccess', '/js/', '/js/audio/', '/.well-known/', '/no/such/page'];
const TYPES = { '/LICENSE': /^text\/plain; charset=utf-8$/, '/manifest.webmanifest': /^application\/manifest\+json/, '/js/app.js': /javascript/, '/css/style.css': /^text\/css/, '/icon.svg': /^image\/svg\+xml/, '/': /^text\/html/ };

/** Every path of the site answers 200 with its headers, and everything else the not-found
 *  page with the same headers. Where the host hands /api/ to the API, what is under it is the
 *  API's to answer (`api`), and is checked by `answersApi` instead. */
async function serves(label, origin, headers = {}, { allowed = [], api = false } = {}) {
  const wrong = [];
  for (const p of SERVED.filter((x) => !(api && x.startsWith('/api/')))) {
    const r = await get(`${origin}${p}`, headers);
    const bad = wrongHeaders(r, p);
    if (r.status !== 200 || bad.length || (TYPES[p] && !TYPES[p].test(r.headers['content-type'] || ''))) wrong.push(`${p} ${r.status} ${r.headers['content-type']}${bad.length ? ` (${bad.join('; ')})` : ''}`);
  }
  check(wrong.length === 0, `${label}: every file of the site answers 200, typed, with every header _headers gives it (${SERVED.filter((x) => !(api && x.startsWith('/api/'))).length} paths${api ? '; /api/ is the API\'s' : ''})${wrong.length ? `; wrong: ${wrong.join(' | ')}` : ''}`);
  const leaked = [];
  for (const p of REFUSED.filter((x) => !(api && x.startsWith('/api/')))) {
    const r = await get(`${origin}${p}`, headers);
    const bad = wrongHeaders(r, '/404.html');
    const status = allowed.includes(p) ? [403, 404] : [404];
    if (!status.includes(r.status) || !r.body.includes(NOT_FOUND) || bad.length) leaked.push(`${p} ${r.status}${bad.length ? ` (${bad.join('; ')})` : ''}`);
  }
  check(leaked.length === 0, `${label}: the repository's files, the host's configuration and the folders answer the site's not-found page, with the same headers (${REFUSED.filter((x) => !(api && x.startsWith('/api/'))).length} paths)${leaked.length ? `; wrong: ${leaked.join(' | ')}` : ''}`);
}

/** What a host that hands /api/ to the API answers there: the API's own answer and headers, with
 *  the site's HSTS line and none of the page's headers (its policy, its referrer policy, its cache
 *  rule), whatever the folder holds under api/. */
async function answersApi(label, origin, headers = {}) {
  const wrong = [];
  const site = want('/index.html');
  for (const [p, status, body] of [['/api/config', 200, API_CONFIG], ['/api/me', 404, '{"error":"not_found"}'], ['/api/secret.json', 404, '{"error":"not_found"}']]) {
    const r = await get(`${origin}${p}`, headers);
    const bad = Object.entries(API_HEADERS).filter(([name, value]) => r.headers[name] !== value).map(([name]) => `${name}: ${r.headers[name]}`);
    if (r.headers['strict-transport-security'] !== site['strict-transport-security']) bad.push(`strict-transport-security: ${r.headers['strict-transport-security']}`);
    for (const name of ['permissions-policy', 'x-frame-options', 'cross-origin-opener-policy']) if (r.headers[name] !== undefined) bad.push(`${name} (the page's) was sent`);
    const cache = p === '/api/config' ? 'public, max-age=60' : 'no-store';
    if (r.headers['cache-control'] !== cache) bad.push(`cache-control: ${r.headers['cache-control']}`);
    if (r.status !== status || r.body !== body || bad.length) wrong.push(`${p} ${r.status} ${r.body.slice(0, 60)}${bad.length ? ` (${bad.join('; ')})` : ''}`);
  }
  check(wrong.length === 0, `${label}: /api/ is the API's, with its own headers and HSTS, and nothing in the folder under api/ is served${wrong.length ? `; wrong: ${wrong.join(' | ')}` : ''}`);
}

const children = [];
function start(cmd, args, log, env) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  children.push(child);
  return () => output + (log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
}

async function nginx() {
  const ndir = path.join(work, 'nginx');
  fs.mkdirSync(path.join(ndir, 'logs'), { recursive: true });
  const [plain, tls] = [await freePort(), await freePort()];
  // deploy/nginx.conf as the README says to install it: root and the certificate paths set, and
  // here the ports. Each edit must find its line exactly once, so a file that has moved on fails
  // here rather than being tested as something it no longer is. The listen lines keep whatever
  // else they ask for, and every other line is loaded as written.
  let conf = fs.readFileSync(path.join(root, 'deploy', 'nginx.conf'), 'utf8');
  const edits = [];
  const edit = (from, to) => {
    const found = typeof from === 'string' ? conf.split(from).length - 1 : [...conf.matchAll(new RegExp(from.source, 'gm'))].length;
    edits.push(found === 1 ? null : `${from} found ${found} times`);
    conf = conf.replace(from, to);
  };
  edit('  listen 80;\n', `  listen 127.0.0.1:${plain};\n`);
  edit('  listen [::]:80;\n', '');
  edit(/^ {2}listen 443 ([^;\n]*);$/m, `  listen 127.0.0.1:${tls} $1;`);
  edit(/^ {2}listen \[::\]:443 [^;\n]*;\n/m, '');
  edit('  root /var/www/ambient-noiser;\n', `  root ${dir};\n`);
  edit('/etc/letsencrypt/live/example.com/fullchain.pem', cert);
  edit('/etc/letsencrypt/live/example.com/privkey.pem', key);
  edit('proxy_pass http://127.0.0.1:8788;', `proxy_pass http://127.0.0.1:${apiPort};`);
  const bad = edits.filter(Boolean);
  check(bad.length === 0, `deploy/nginx.conf has the lines an install sets${bad.length ? `: ${bad.join(', ')}` : ''}`);
  fs.writeFileSync(path.join(ndir, 'site.conf'), conf);
  // the http {} block a stock Debian or Ubuntu nginx.conf includes it from, less the logging
  fs.writeFileSync(path.join(ndir, 'nginx.conf'), [
    ...(asRoot ? ['user www-data;'] : []),
    'worker_processes 1;',
    `pid ${path.join(ndir, 'nginx.pid')};`,
    'events {}',
    'http {',
    '  include /etc/nginx/mime.types;',
    '  default_type application/octet-stream;',
    '  access_log off;',
    ...['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map((t) => `  ${t}_temp_path ${path.join(ndir, `${t}_temp`)};`),
    `  include ${path.join(ndir, 'site.conf')};`,
    '}',
    '',
  ].join('\n'));
  const args = ['-p', ndir, '-e', path.join(ndir, 'logs', 'error.log'), '-c', path.join(ndir, 'nginx.conf')];
  const version = spawnSync(NGINX, ['-v'], { encoding: 'utf8' }).stderr.trim().replace(/^nginx version: /, '');
  const test = spawnSync(NGINX, ['-t', ...args], { encoding: 'utf8' });
  check(test.status === 0 && !/\[emerg\]/.test(test.stderr), `${version} loads deploy/nginx.conf${test.status === 0 ? '' : `: ${test.stderr.trim()}`}`);
  if (test.status !== 0) return;

  const log = start(NGINX, [...args, '-g', 'daemon off;'], path.join(ndir, 'logs', 'error.log'));
  const origin = `https://127.0.0.1:${tls}`;
  await waitFor(`${origin}/`, log);
  await serves('nginx', origin, {}, { api: true });
  await answersApi('nginx', origin);
  const redirect = await get(`http://127.0.0.1:${plain}/a/b?x=1`);
  check(redirect.status === 301 && redirect.headers.location === 'https://127.0.0.1/a/b?x=1', `nginx: plain http answers a 301 to https (${redirect.status} ${redirect.headers.location})`);
}

async function apache() {
  const adir = path.join(work, 'apache');
  fs.mkdirSync(adir, { recursive: true });
  const [plain, tls, proxied] = [await freePort(), await freePort(), await freePort()];
  // Apache with the modules the .htaccess names, and AllowOverride All, which its
  // ServerSignature needs; the site at the document root, as the README's Apache row builds it.
  fs.writeFileSync(path.join(adir, 'httpd.conf'), [
    `ServerRoot ${adir}`,
    `DefaultRuntimeDir ${adir}`,
    `PidFile ${path.join(adir, 'httpd.pid')}`,
    `ErrorLog ${path.join(adir, 'error.log')}`,
    'LogLevel warn',
    'ServerName localhost',
    ...(asRoot ? ['User www-data', 'Group www-data'] : []),
    ...['mpm_event', 'authz_core', 'mime', 'dir', 'rewrite', 'headers', 'ssl', 'socache_shmcb', 'proxy', 'proxy_http']
      .map((m) => `LoadModule ${m}_module ${path.join(MODULES, `mod_${m}.so`)}`),
    'TypesConfig /etc/mime.types',
    `SSLSessionCache shmcb:${path.join(adir, 'ssl_scache')}(512000)`,
    `DocumentRoot ${dir}`,
    '<Directory />',
    '  AllowOverride None',
    '  Require all denied',
    '</Directory>',
    `<Directory ${dir}>`,
    '  AllowOverride All',
    '  Require all granted',
    '</Directory>',
    // a stock install refuses .ht* itself
    '<FilesMatch "^\\.ht">',
    '  Require all denied',
    '</FilesMatch>',
    `Listen 127.0.0.1:${plain}`,
    `Listen 127.0.0.1:${tls}`,
    `Listen 127.0.0.1:${proxied}`,
    `<VirtualHost 127.0.0.1:${tls}>`,
    '  SSLEngine on',
    `  SSLCertificateFile ${cert}`,
    `  SSLCertificateKeyFile ${key}`,
    '</VirtualHost>',
    // The site with its API, as .htaccess says to set it up: .htaccess cannot proxy, so the
    // virtual host hands /api/ to server/start.mjs, and sends HSTS there itself, since a proxied
    // answer never reads .htaccess.
    `<VirtualHost 127.0.0.1:${proxied}>`,
    '  SSLEngine on',
    `  SSLCertificateFile ${cert}`,
    `  SSLCertificateKeyFile ${key}`,
    `  ProxyPass "/api/" "http://127.0.0.1:${apiPort}/api/"`,
    '  <Location "/api/">',
    `    Header always set Strict-Transport-Security "${want('/index.html')['strict-transport-security']}"`,
    '  </Location>',
    '</VirtualHost>',
    '',
  ].join('\n'));
  const version = spawnSync(APACHE, ['-v'], { encoding: 'utf8' }).stdout.split('\n')[0].replace(/^Server version: /, '');
  const test = spawnSync(APACHE, ['-t', '-f', path.join(adir, 'httpd.conf')], { encoding: 'utf8' });
  check(test.status === 0, `${version} loads its configuration${test.status === 0 ? '' : `: ${test.stderr.trim()}`}`);
  if (test.status !== 0) return;
  const log = start(APACHE, ['-f', path.join(adir, 'httpd.conf'), '-DFOREGROUND'], path.join(adir, 'error.log'));
  await waitFor(`https://127.0.0.1:${tls}/`, log);

  await serves('Apache over https', `https://127.0.0.1:${tls}`, {}, { allowed: ['/.htaccess'] });
  await serves('Apache with the API proxied', `https://127.0.0.1:${proxied}`, {}, { allowed: ['/.htaccess'], api: true });
  await answersApi('Apache with the API proxied', `https://127.0.0.1:${proxied}`);
  // Behind a proxy that ended TLS, which is what the redirect's X-Forwarded-Proto is for: this
  // Apache speaks plain http, and the proxy says the visitor used https.
  await serves('Apache behind a TLS-terminating proxy', `http://127.0.0.1:${plain}`, { 'X-Forwarded-Proto': 'https' }, { allowed: ['/.htaccess'] });
  const redirect = await get(`http://127.0.0.1:${plain}/a?x=1`);
  check(redirect.status === 301 && redirect.headers.location === `https://127.0.0.1:${plain}/a?x=1`, `Apache: plain http answers a 301 to https (${redirect.status} ${redirect.headers.location})`);
  // the stock refusal of .htaccess (AH01630) is logged as an error and is not one
  const errors = log().split('\n').filter((l) => /:(error|crit|alert|emerg)\]/.test(l) && !/AH01630: client denied by server configuration: \S+\/\.htaccess$/.test(l));
  check(errors.length === 0, `Apache logged no error while serving${errors.length ? `: ${errors.join(' | ')}` : ''}`);
}

// The API with nothing configured, as a deployment starts it before its variables are set:
// server/start.mjs on loopback, its records in a directory outside the site.
const apiPort = await freePort();
const apiLog = start(process.execPath, [path.join(root, 'server', 'start.mjs')], null,
  { PATH: process.env.PATH, KIT_DATA_DIR: path.join(work, 'api-data'), KIT_HOST: '127.0.0.1', KIT_PORT: String(apiPort) });
try {
  await waitFor(`http://127.0.0.1:${apiPort}/api/config`, apiLog);
  await nginx();
  await apache();
} catch (e) {
  console.error(e);
  failures++;
} finally {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map((c) => (c.exitCode === null && c.signalCode === null ? new Promise((r) => c.once('exit', r)) : null)));
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall host checks passed');
process.exit(failures ? 1 : 0);
