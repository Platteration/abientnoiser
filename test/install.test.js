const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/install.js');
const AN = globalThis.AN;

/** Just enough of a window and a button: listeners by type, and `hidden`. The browser
 *  suite cannot stage beforeinstallprompt, so the handler is driven here with a fake
 *  event, the way phonogeometry's test/fakeDom.js stands in for its document. */
function fakeTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).concat(fn)); },
    dispatch(type, event = {}) { for (const fn of listeners.get(type) || []) fn(event); },
  };
}
function fakeEvent(outcome = 'accepted') {
  const e = { prevented: 0, prompted: 0, preventDefault() { this.prevented++; } };
  e.prompt = () => { e.prompted++; return outcome === 'reject' ? Promise.reject(new Error('not installable')) : Promise.resolve({ outcome }); };
  return e;
}
function setup() {
  const win = fakeTarget();
  const button = Object.assign(fakeTarget(), { hidden: true });
  AN.installPrompt(win, button);
  return { win, button };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('the button stays hidden until the browser offers a prompt: Safari never does', () => {
  const { button } = setup();
  assert.equal(button.hidden, true);
  button.dispatch('click');
  assert.equal(button.hidden, true, 'a click with nothing to prompt is nothing');
});

test('beforeinstallprompt is deferred behind the button, and a click spends it', async () => {
  const { win, button } = setup();
  const e = fakeEvent();
  win.dispatch('beforeinstallprompt', e);
  assert.equal(e.prevented, 1, 'the browser\'s own mini-infobar is kept away');
  assert.equal(button.hidden, false, 'and the page offers its button instead');
  assert.equal(e.prompted, 0, 'nothing is prompted until the visitor asks');

  button.dispatch('click');
  await tick();
  assert.equal(e.prompted, 1);
  assert.equal(button.hidden, true, 'a prompt event can be used once, so the button goes until another comes');
  button.dispatch('click');
  await tick();
  assert.equal(e.prompted, 1, 'a second click does not prompt a spent event');
});

test('a dismissed prompt is not retried by itself; the next offer shows the button again', async () => {
  const { win, button } = setup();
  win.dispatch('beforeinstallprompt', fakeEvent('dismissed'));
  button.dispatch('click');
  await tick();
  assert.equal(button.hidden, true);
  const again = fakeEvent();
  win.dispatch('beforeinstallprompt', again);
  assert.equal(button.hidden, false);
  button.dispatch('click');
  await tick();
  assert.equal(again.prompted, 1);
});

test('appinstalled hides the button for good', async () => {
  const { win, button } = setup();
  const e = fakeEvent();
  win.dispatch('beforeinstallprompt', e);
  win.dispatch('appinstalled');
  assert.equal(button.hidden, true);
  button.dispatch('click');
  await tick();
  assert.equal(e.prompted, 0, 'an installed app is not prompted to install');
});

test('a prompt that rejects does not take the page down', async () => {
  const { win, button } = setup();
  let unhandled = null;
  const onUnhandled = (err) => { unhandled = err; };
  process.on('unhandledRejection', onUnhandled);
  try {
    win.dispatch('beforeinstallprompt', fakeEvent('reject'));
    button.dispatch('click');
    await tick(); await tick();
  } finally { process.off('unhandledRejection', onUnhandled); }
  assert.equal(unhandled, null);
});
