/**
 * esbuild configuration for frontend bundling
 *
 * Produces minified, bundled output for production.
 * Post-build hooks keep index.html (SRI hash) and service-worker.js (cache key)
 * in sync automatically.
 */
const esbuild = require('esbuild');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const isAnalyze = process.argv.includes('--analyze');

// Read version from package.json (single source of truth)
const pkg = require('./package.json');
const define = { __APP_VERSION__: JSON.stringify(pkg.version) };

/** @type {import('esbuild').BuildOptions} */
const appConfig = {
    entryPoints: [path.join(__dirname, 'src/frontend/app.ts')],
    bundle: true,
    minify: true,
    sourcemap: true,
    target: ['es2022'],
    format: 'esm',
    outdir: path.join(__dirname, 'public/js/modules'),
    splitting: true,
    treeShaking: true,
    // Keep the same output structure so existing <script type="module"> works
    chunkNames: 'chunks/[name]-[hash]',
    logLevel: 'info',
    define,
};

/** @type {import('esbuild').BuildOptions} */
const socketClientConfig = {
    entryPoints: [path.join(__dirname, 'src/frontend/socket-client.ts')],
    bundle: true,
    minify: true,
    sourcemap: true,
    target: ['es2022'],
    format: 'iife',
    outfile: path.join(__dirname, 'public/js/socket-client.js'),
    treeShaking: true,
    logLevel: 'info',
    define,
};

/**
 * Update the content-hash ?v= cache-bust for a same-origin <script> in index.html.
 *
 * These are first-party scripts loaded under script-src 'self', so they carry no
 * SRI integrity attribute (an integrity hash that drifts from a browser/SW-cached
 * copy would hard-block the script and break the whole app — a recurring failure).
 * Freshness is handled purely by this query string: it is derived from the file
 * contents, so the URL changes whenever — and only when — the bytes change. A
 * content change therefore always misses the HTTP cache and fetches the new file,
 * while unchanged files keep a stable URL and stay cacheable.
 *
 * @param {string} scriptPath  absolute path to the built/vendored asset on disk
 * @param {string} urlPath     the script's src path in index.html (without the query)
 */
function updateScriptVersion(scriptPath, urlPath) {
    // index.html is a real file served from server/public/ (same in local dev and
    // the Docker build, where esbuild.config.js sits next to public/).
    const indexPath = path.join(__dirname, 'public/index.html');

    if (!fs.existsSync(scriptPath) || !fs.existsSync(indexPath)) {
        console.warn(`Cache-bust update skipped: missing ${path.basename(scriptPath)} or index.html`);
        return;
    }

    const fileContents = fs.readFileSync(scriptPath);
    // First 8 hex chars of the content hash — stable per content, changes on edit.
    const contentVersion = crypto.createHash('sha384').update(fileContents).digest('hex').slice(0, 8);

    let html = fs.readFileSync(indexPath, 'utf8');
    const escaped = urlPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match the src with or without an existing ?v= parameter.
    const pattern = new RegExp(`(${escaped})(\\?v=[A-Za-z0-9]+)?(")`);
    if (!pattern.test(html)) {
        console.warn(`Cache-bust update skipped: could not find ${urlPath} in index.html`);
        return;
    }

    html = html.replace(pattern, `$1?v=${contentVersion}$3`);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log(`Updated ${urlPath}: version=${contentVersion}`);
}

/**
 * Update the cache-bust version on app.js in index.html.
 * Without this, browsers with maxAge caching serve stale app.js for up to
 * 1 day after a deploy, causing the setup screen buttons to be completely
 * non-functional (JS never loads, event handlers never attach).
 */
function updateAppJsVersion() {
    const appJsPath = path.join(appConfig.outdir, 'app.js');
    const indexPath = path.join(__dirname, 'public/index.html');

    if (!fs.existsSync(appJsPath) || !fs.existsSync(indexPath)) {
        console.warn('app.js version update skipped: missing app.js or index.html');
        return;
    }

    const fileContents = fs.readFileSync(appJsPath);
    const contentVersion = crypto.createHash('sha256').update(fileContents).digest('hex').slice(0, 8);

    let html = fs.readFileSync(indexPath, 'utf8');
    // Match app.js with or without an existing ?v= parameter
    const pattern = /(\/js\/modules\/app\.js)(\?v=[A-Za-z0-9]+)?(")/;
    if (!pattern.test(html)) {
        console.warn('app.js version update skipped: could not find app.js script tag in index.html');
        return;
    }

    html = html.replace(pattern, `$1?v=${contentVersion}$3`);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log(`Updated app.js: version=${contentVersion}`);
}

/**
 * Sync the service-worker cache key with the version from package.json.
 * Prevents stale cache names when the version is bumped.
 */
function updateServiceWorkerVersion() {
    const swPath = path.join(__dirname, 'public/service-worker.js');
    if (!fs.existsSync(swPath)) {
        console.warn('Service worker version update skipped: file not found');
        return;
    }

    let sw = fs.readFileSync(swPath, 'utf8');
    const pattern = /(const CACHE = 'eigennamen-v)[^']+(')/;
    if (!pattern.test(sw)) {
        console.warn('Service worker version update skipped: could not find CACHE constant');
        return;
    }

    sw = sw.replace(pattern, `$1${pkg.version}$2`);
    fs.writeFileSync(swPath, sw, 'utf8');
    console.log(`Updated service-worker.js: CACHE=eigennamen-v${pkg.version}`);
}

async function build() {
    if (isWatch) {
        const [appCtx, socketCtx] = await Promise.all([
            esbuild.context(appConfig),
            esbuild.context(socketClientConfig),
        ]);
        await Promise.all([appCtx.watch(), socketCtx.watch()]);
        console.log('Watching for changes...');
    } else {
        const [appResult, socketResult] = await Promise.all([
            esbuild.build({ ...appConfig, metafile: isAnalyze }),
            esbuild.build({ ...socketClientConfig, metafile: isAnalyze }),
        ]);
        updateScriptVersion(socketClientConfig.outfile, '/js/socket-client.js');
        updateScriptVersion(path.join(__dirname, 'public/js/socket.io.min.js'), '/js/socket.io.min.js');
        updateAppJsVersion();
        updateServiceWorkerVersion();
        if (isAnalyze) {
            console.log('\n=== App Bundle Analysis ===');
            console.log(await esbuild.analyzeMetafile(appResult.metafile));
            console.log('\n=== Socket Client Bundle Analysis ===');
            console.log(await esbuild.analyzeMetafile(socketResult.metafile));
        }
        console.log('Frontend bundle built successfully');
    }
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
