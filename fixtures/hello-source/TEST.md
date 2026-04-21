# Building React from source and using it in a plain HTML page

This fixture builds React (and `react-dom`) from the source in this repo and
runs a small counter app in the browser — no webpack, Vite, Next.js, or JSX.

It works with the current `main` branch (React 19.3.0-experimental at time of
writing), which no longer ships UMD bundles. The build produces CommonJS
files; the `index.html` in this folder loads them with a tiny in-page CJS
shim.

Files in this folder:

- `index.html` — the demo page (loads the built bundles and renders a counter)
- `test.js` — JSDOM smoke test for `index.html`
- `TEST.md` — this document

---

## 1. Prerequisites

- **Node 18 or newer.** Node 16 is too old for the current build tooling.
- **Yarn 1.22.22** (pinned via `packageManager` in the root `package.json`).
- **A JDK between 11 and 21.** The build uses Google Closure Compiler, which
  ships as a `.jar`. JDK 24 emits a deprecation warning on stderr that the
  bundled `google-closure-compiler@20230206.0.0` treats as an error.

On macOS with `nvm` and Homebrew:

```bash
# Node 22 from nvm
source ~/.nvm/nvm.sh
nvm use 22
node --version      # v22.x

# Yarn 1.22.22 via corepack
corepack enable
corepack prepare yarn@1.22.22 --activate
yarn --version      # 1.22.22

# Use JDK 21 if Homebrew has installed newer (24+) as the default
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@21/21.0.8/libexec/openjdk.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH
java -version       # should say 21.x
```

If `openjdk@21` isn't installed:

```bash
brew install openjdk@21
```

---

## 2. Install dependencies

Run from the repository root:

```bash
yarn install --frozen-lockfile --ignore-scripts
```

`--ignore-scripts` skips the `prebuild` hook that links the React Compiler;
we don't need it for this demo. Expect a minute or two and a lot of peer
dependency warnings — those are harmless.

---

## 3. Build the browser-facing packages

Still from the repository root:

```bash
yarn build react/index,react/jsx,react-dom/index,react-dom/client,scheduler --type=NODE_DEV
```

What this does:

- `yarn build` invokes `scripts/rollup/build-all-release-channels.js`.
- The positional list restricts the build to only the bundles we need:
  - `react/index` → the core React package (`React.createElement`, hooks, …)
  - `react/jsx` → the automatic JSX runtime (optional here; handy later)
  - `react-dom/index` → the legacy `ReactDOM` entry
  - `react-dom/client` → the modern `createRoot` entry
  - `scheduler` → required by `react-dom/client`
- `--type=NODE_DEV` asks for only the development CommonJS bundles
  (readable, with warnings, `__DEV__` on).

The build takes roughly 30–60 seconds and writes to `build/oss-experimental/`.
The four files `index.html` actually loads are:

```
build/oss-experimental/
  scheduler/cjs/scheduler.development.js
  react/cjs/react.development.js
  react-dom/cjs/react-dom.development.js
  react-dom/cjs/react-dom-client.development.js
```

(The build also emits sibling bundles like `react-jsx-runtime.development.js`
and `scheduler-unstable_mock.development.js` — we don't need them here.)

These files are **CommonJS**: they use `module.exports`, `require(...)`, and
`process.env.NODE_ENV`. Browsers can't execute them natively. `index.html`
ships a 20-line loader that supplies those globals so the bundles can run
without a bundler.

> **Production build** (optional): run with `--type=NODE_PROD` to get
> `*.production.js` files, then change the URLs in `index.html` accordingly
> and set `NODE_ENV: "production"`.

---

## 4. Run the demo

You must serve the repo over HTTP. Opening `index.html` with `file://`
won't work because it uses `fetch()`. Any static server works. From the
repository root:

```bash
python3 -m http.server 5173
```

Then open:

```
http://127.0.0.1:5173/fixtures/hello-source/index.html
```

You should see:

- The title **Hello React (from source build)**
- A version line like `React 19.3.0-experimental-...`
- A card saying "You clicked 0 times." with **Increment** and **Reset**
  buttons
- No red error text at the bottom

Clicking **Increment** bumps the counter; **Reset** zeroes it.

If something goes wrong, the page renders the error (and stack) in the red
`<pre id="err">` block, and the browser's DevTools console will have more
detail. The most common failure is a 404 on one of the `build/...` URLs,
which means the build step was skipped or a different release channel was
built.

---

## 5. (Optional) Run the headless smoke test

```bash
node fixtures/hello-source/test.js
```

Expected output (version number will change as React evolves):

```
[PASS] React 19.3.0-experimental-...
[PASS] initial counter = 0
[PASS] counter after 3 increments = 3
[PASS] counter after reset = 0
[info] console.error count: 0
[info] console.warn  count: 0
```

The test loads `index.html` in JSDOM, intercepts `fetch()` to read the built
bundles from disk, clicks the Increment button three times and then Reset,
and asserts on the DOM after each step. It exits non-zero on any failure.

---

## How the CJS-in-browser loader works

React's CJS bundles look like:

```js
"use strict";
"production" !== process.env.NODE_ENV &&
  (function () {
    // ...lots of code, uses `require(...)`, writes to `exports.*`
  })();
```

`index.html` provides the missing pieces:

1. A stub `window.process` with `env.NODE_ENV = "development"`.
2. A `modules` registry and a local `require(name)` that reads from it.
3. `loadCjs(name, url)` fetches the file as text, wraps it in a
   `new Function("module", "exports", "require", "process", src)`, calls it
   with a fresh `module` object, and stores `module.exports` in the
   registry.
4. Bundles are loaded in dependency order: `scheduler`, then `react`, then
   `react-dom`, then `react-dom/client`.

The `//# sourceURL=` pragma makes each fetched bundle appear as a separate
file in DevTools' Sources panel, so you can set breakpoints and step into
React internals.

---

## Writing JSX (optional)

This fixture uses `React.createElement(...)` directly to avoid any
build step. If you'd rather write JSX, add Babel standalone to the page:

```html
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script type="text/babel" data-presets="react">
  const root = ReactDOMClient.createRoot(document.getElementById("root"));
  root.render(<h1>Hello {name}!</h1>);
</script>
```

See `fixtures/packaging/babel-standalone/dev.html` for a similar setup
(note that that fixture still uses the removed `ReactDOM.render` — use
`createRoot` with React 19 as shown above).
