const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const serve = path.resolve(__dirname, '..', 'scripts', 'serve.js');
const port = 5700 + Math.floor(Math.random() * 200);

function get(pathname) {
  return fetch(`http://localhost:${port}${pathname}`).then(
    (r) => ({ status: r.status }),
    (e) => ({ error: e.cause ? e.cause.code || String(e.cause) : String(e) })
  );
}

test('the dev server survives the requests a browser actually makes', async (t) => {
  const server = spawn(process.execPath, [serve], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  t.after(() => server.kill());
  for (let i = 0; i < 50; i++) {
    if ((await get('/index.html')).status === 200) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert.equal((await get('/index.html')).status, 200, 'serves the page');

  // a malformed percent-escape is a bad request, not a crash
  assert.equal((await get('/%zz')).status, 400, 'rejects a malformed escape');
  assert.equal((await get('/index.html')).status, 200, 'still alive after a malformed URL');

  // a NUL byte reaches fs.stat, which throws synchronously and took the process with it
  assert.equal((await get('/%00')).status, 400, 'rejects a NUL byte in the path');
  assert.equal((await get('/js/%00app.js')).status, 400, 'rejects a NUL byte mid-path');
  assert.equal((await get('/index.html')).status, 200, 'still alive after a NUL byte');

  // the checkout is not the site: dotfiles stay unreachable even though they are in the root
  assert.equal((await get('/.git/HEAD')).status, 404, 'does not serve the git directory');
  assert.equal((await get('/.github/workflows/ci.yml')).status, 404, 'does not serve the workflows');

  // nothing outside the project is reachable
  assert.equal((await get('/../../etc/passwd')).status, 404);
  assert.equal((await get('/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).status, 403);
  assert.equal((await get('/index.html')).status, 200, 'still alive after traversal attempts');

  // aborted requests must not take it down either
  await Promise.all(Array.from({ length: 40 }, () => {
    const ac = new AbortController();
    const p = fetch(`http://localhost:${port}/js/app.js`, { signal: ac.signal }).catch(() => {});
    setTimeout(() => ac.abort(), Math.random() * 8);
    return p;
  }));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await get('/index.html')).status, 200, 'still alive after aborted requests');
});
