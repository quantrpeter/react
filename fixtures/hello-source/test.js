// Smoke-test for fixtures/hello-source/index.html.
//
// We load the HTML via JSDOM. The page uses fetch() to pull the built CJS
// bundles at runtime, so we intercept fetch to read the files from disk
// instead of going over HTTP.
//
// Run with:  node fixtures/hello-source/test.js

'use strict';

const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML_PATH = path.join(__dirname, 'index.html');

const html = fs.readFileSync(HTML_PATH, 'utf8');

// Map the BUILD-relative URLs used by the page to filesystem paths.
function resolveFetchUrl(url) {
  if (url.startsWith('../../')) {
    return path.resolve(__dirname, url);
  }
  throw new Error('Unexpected fetch url: ' + url);
}

// JSDOM's default fetch doesn't understand ../../ URLs without a page origin;
// we swap it for a local-file fetch.
const localFetch = async url => {
  const p = resolveFetchUrl(url);
  if (!fs.existsSync(p)) {
    return {
      ok: false,
      status: 404,
      text: async () => '',
    };
  }
  return {
    ok: true,
    status: 200,
    text: async () => fs.readFileSync(p, 'utf8'),
  };
};

const dom = new JSDOM(html, {
  url: 'http://localhost/fixtures/hello-source/index.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = localFetch;
  },
});

const {window} = dom;
const {document} = window;

// Console relay so we see any React warnings / errors.
const consoleMessages = [];
['log', 'warn', 'error', 'info'].forEach(level => {
  const original = window.console[level].bind(window.console);
  window.console[level] = (...args) => {
    consoleMessages.push({level, args});
    original(...args);
  };
});

(async () => {
  // Wait for the async main() in the page to finish: 4 fetches, then the
  // initial concurrent render. React's scheduler uses MessageChannel under the
  // hood, which JSDOM supports but only advances via macrotasks.
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 10));
    const versionEl = document.getElementById('version');
    const root = document.getElementById('root');
    if (
      versionEl &&
      /^React /.test(versionEl.textContent) &&
      root &&
      root.firstChild
    ) {
      break;
    }
  }

  const errEl = document.getElementById('err');
  if (errEl && errEl.textContent.trim()) {
    console.error('\n[FAIL] Error panel contents:\n' + errEl.textContent);
    process.exit(1);
  }

  const versionText = document.getElementById('version').textContent;
  if (!/^React \S+/.test(versionText)) {
    console.error('[FAIL] version text not set: ' + JSON.stringify(versionText));
    process.exit(1);
  }

  const root = document.getElementById('root');
  if (!root || !root.firstChild) {
    console.error('[FAIL] #root has no children. innerHTML=', root && root.innerHTML);
    console.error('  version text:', JSON.stringify(versionText));
    console.error('  err panel:', JSON.stringify(document.getElementById('err').textContent));
    console.error('  console errors:', consoleMessages.filter(m => m.level === 'error').map(m => String(m.args[0]).slice(0, 200)));
    console.error('  console warns:',  consoleMessages.filter(m => m.level === 'warn').map(m => String(m.args[0]).slice(0, 200)));
    process.exit(1);
  }

  // Initial render
  let card = root.querySelector('.card');
  if (!card || !/You clicked/.test(card.textContent)) {
    console.error('[FAIL] initial render missing. root.innerHTML=', root.innerHTML);
    process.exit(1);
  }
  if (!/You clicked\s*0\s*times/.test(card.textContent)) {
    console.error('[FAIL] initial count not 0: ' + card.textContent);
    process.exit(1);
  }

  // Click Increment 3 times.
  const buttons = Array.from(root.querySelectorAll('button'));
  const inc = buttons.find(b => b.textContent === 'Increment');
  const reset = buttons.find(b => b.textContent === 'Reset');
  if (!inc || !reset) {
    console.error('[FAIL] missing buttons');
    process.exit(1);
  }

  for (let i = 0; i < 3; i++) {
    inc.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
    await new Promise(r => setTimeout(r, 30));
  }

  card = root.querySelector('.card');
  if (!/You clicked\s*3\s*times/.test(card.textContent)) {
    console.error('[FAIL] after 3 increments, text=' + card.textContent);
    process.exit(1);
  }

  reset.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
  await new Promise(r => setTimeout(r, 30));

  card = root.querySelector('.card');
  if (!/You clicked\s*0\s*times/.test(card.textContent)) {
    console.error('[FAIL] after reset, text=' + card.textContent);
    process.exit(1);
  }

  // Filter out noisy DevTools pings that React prints in DEV.
  const errors = consoleMessages.filter(m => m.level === 'error');
  const warnings = consoleMessages.filter(m => m.level === 'warn');

  console.log('\n[PASS] ' + versionText);
  console.log('[PASS] initial counter = 0');
  console.log('[PASS] counter after 3 increments = 3');
  console.log('[PASS] counter after reset = 0');
  console.log('[info] console.error count:', errors.length);
  console.log('[info] console.warn  count:', warnings.length);
  if (errors.length) {
    console.log('\n[info] first error:');
    console.log(String(errors[0].args[0]).slice(0, 400));
  }

  process.exit(0);
})().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exit(1);
});
