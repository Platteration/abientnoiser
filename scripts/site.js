#!/usr/bin/env node
/* The website: the files a visitor's browser loads, and nothing else from the repository.
 *
 *   node scripts/site.js <folder>                    write the site into <folder>
 *   node scripts/site.js <folder> --host=<name>      and the config that host reads from it
 *   node scripts/site.js --list                      print the site's files, one per line
 *
 * The Pages deploy archives `--list` out of the commit, so what is published is the commit's
 * own bytes; the browser suite builds a folder from the working tree the same way. The list
 * is the service worker's SHELL (read out of sw.js rather than restated, so a module added to
 * the page and the shell is published without a second edit) plus what a site has beside the
 * shell. Nothing else is published: not the notes, the tests, the dev server or the hosting
 * configs, which a host reads but would otherwise serve. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/** Beside the shell: the worker itself, the not-found page every host answers a missing
 *  address with, robots.txt, the security contact (RFC 9116) and the licence the scripts are
 *  published under. */
const EXTRA = ['sw.js', '404.html', 'robots.txt', '.well-known/security.txt', 'LICENSE'];

/** The config each header-capable host reads from the folder it publishes. GitHub Pages reads
 *  none and would serve them as files, and nginx's lives in the server's own config, so those
 *  two get the site alone. Netlify reads _headers and _redirects (whose rules also answer 404
 *  for both); Cloudflare Pages reads _headers but takes no 404 rule from _redirects, so there
 *  the folder holding nothing else is the protection; Apache refuses to serve .htaccess in its
 *  default configuration. */
const HOST_FILES = {
  pages: [],
  nginx: [],
  netlify: ['_headers', '_redirects'],
  cloudflare: ['_headers'],
  apache: ['.htaccess'],
};

/** sw.js's SHELL, as paths relative to the site's root; './' is the page itself. */
function shell() {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  if (!block) throw new Error('sw.js declares no SHELL');
  return [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1].replace(/^\.\//, '')).filter(Boolean);
}

/** Every file of the site, sorted. */
function siteFiles() {
  return [...new Set([...shell(), ...EXTRA])].sort();
}

/** Write the site, and the config `host` reads, into `out` (which must not exist yet or be
 *  empty: a folder holding something else would be published with it). */
function build(out, { host = 'pages' } = {}) {
  if (!Object.hasOwn(HOST_FILES, host)) throw new Error(`unknown host '${host}': one of ${Object.keys(HOST_FILES).join(', ')}`);
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`${out} is not empty`);
  const files = [...siteFiles(), ...HOST_FILES[host]];
  for (const f of files) {
    const to = path.join(out, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, f), to);
  }
  return files;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--list' && args.length === 1) {
    process.stdout.write(`${siteFiles().join('\n')}\n`);
  } else if (args.length >= 1 && !args[0].startsWith('-') && args.slice(1).every((a) => /^--host=/.test(a)) && args.length <= 2) {
    const host = args[1] ? args[1].slice('--host='.length) : 'pages';
    try {
      const files = build(path.resolve(args[0]), { host });
      console.log(`Ambient Noiser: ${files.length} files written to ${args[0]}`);
    } catch (e) {
      console.error(`Ambient Noiser: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.error('usage: node scripts/site.js <folder> [--host=pages|nginx|netlify|cloudflare|apache] | --list');
    process.exit(2);
  }
}

module.exports = { siteFiles, shell, build, EXTRA, HOST_FILES };
