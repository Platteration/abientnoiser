// The browser suites run on GitHub's runner after `npx playwright install --with-deps chromium`,
// which downloads the Chromium build the locked Playwright names for the runner's Ubuntu release
// and fails where it names none. `ubuntu-latest` is a label that moves: from 2026-10-19 it is
// Ubuntu 26.04, for which Playwright 1.56.1 has no build ("Playwright does not support chromium
// on ubuntu26.04-x64"), so CI and the Pages build would have gone red with nothing in the
// repository changed. So every job that installs the browser runs on a named release, and one
// the locked Playwright has a Chromium build for, asked of Playwright itself: its own CLI, told
// that release's platform, says what it would download (--dry-run, nothing is fetched).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/** A workflow's jobs, read from its block YAML (the conventions test holds every workflow to
 *  that shape): each job's name, its runs-on and whether a step installs Playwright's browser. */
function jobs(file) {
  const lines = read(file).split('\n');
  const start = lines.indexOf('jobs:');
  assert.ok(start >= 0, `${file} has jobs`);
  const out = [];
  for (const line of lines.slice(start + 1)) {
    const job = line.match(/^ {2}([\w-]+):\s*$/);
    if (job) { out.push({ name: job[1], runsOn: null, installsBrowser: false }); continue; }
    if (!out.length || line.trimStart().startsWith('#')) continue;
    const runsOn = line.match(/^ {4}runs-on:\s*(\S+)\s*$/);
    if (runsOn) out[out.length - 1].runsOn = runsOn[1];
    if (/\bplaywright install\b/.test(line)) out[out.length - 1].installsBrowser = true;
  }
  return out;
}

/** The Playwright the lockfile installs. */
const LOCKED = JSON.parse(read('package-lock.json')).packages['node_modules/playwright'].version;

/** What the locked Playwright's CLI would download for Chromium on `platform` (an
 *  `ubuntu24.04-x64` as Playwright names one): the download address, or null when it has none. */
function chromiumDownload(platform) {
  const browsers = fs.mkdtempSync(path.join(os.tmpdir(), 'an-pw-'));
  try {
    const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    const run = spawnSync(process.execPath, [cli, 'install', '--dry-run', 'chromium'], {
      encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: platform, PLAYWRIGHT_BROWSERS_PATH: browsers },
    });
    assert.equal(run.status, 0, `playwright install --dry-run chromium on ${platform}: ${run.stderr}`);
    // one block per browser, separated by a blank line; Chromium's is headed "browser: chromium
    // version …" (1.56) or "… (playwright chromium v…)" (later releases)
    const block = run.stdout.split(/\n\s*\n/).find((b) => /^browser: chromium version |\(playwright chromium v\d+\)/m.test(b.split('\n')[0]));
    assert.ok(block, `the dry run names Chromium on ${platform}:\n${run.stdout}`);
    const url = block.match(/^\s*Download url:\s*(\S+)/m);
    return url ? url[1] : null;
  } finally {
    fs.rmSync(browsers, { recursive: true, force: true });
  }
}

test('every job that installs Playwright\'s browser runs on a named Ubuntu release the locked Playwright has a Chromium build for', () => {
  const installing = [];
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/pages.yml']) {
    for (const job of jobs(file).filter((j) => j.installsBrowser)) {
      installing.push(`${file} ${job.name}`);
      const release = String(job.runsOn).match(/^ubuntu-(\d{2}\.\d{2})$/);
      assert.ok(release, `${file}: the ${job.name} job runs on ${job.runsOn}; a job that installs the browser runs on a named Ubuntu release (ubuntu-24.04), never a label that moves`);
      const download = chromiumDownload(`ubuntu${release[1]}-x64`);
      assert.ok(download, `${file}: the ${job.name} job runs on ${job.runsOn}, for which Playwright ${LOCKED} has no Chromium build: raise Playwright, or keep the job on a release it supports`);
    }
  }
  assert.deepEqual(installing, ['.github/workflows/ci.yml check', '.github/workflows/pages.yml build'], 'CI\'s check job and the Pages build install the browser, and this test read both');
  // and the reason in ci.yml names the Playwright that is locked, so raising it is a reason to
  // read the runner again
  assert.match(read('.github/workflows/ci.yml'), new RegExp(`Playwright ${LOCKED.replace(/\./g, '\\.')} has no Chromium build for 26\\.04`), 'ci.yml says why its runner is named, for the Playwright the lockfile pins');
});

test('the Playwright CLI is asked the right question: it names a build for 24.04 and none for 26.04', () => {
  // The check above is only as good as the question: told a platform it supports, the locked
  // CLI gives an address, and told 26.04 (what ubuntu-latest becomes), 1.56.1 gives none.
  assert.match(chromiumDownload('ubuntu24.04-x64') || '', /^https:\/\/\S+\.zip$/);
  if (LOCKED === '1.56.1') assert.equal(chromiumDownload('ubuntu26.04-x64'), null, 'Playwright 1.56.1 has no Chromium build for Ubuntu 26.04');
});
