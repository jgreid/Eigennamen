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
 * Update the SRI integrity hash AND cache-bust version in index.html
 * for socket-client.js. This prevents two recurring bugs:
 * 1. A rebuild changes the file but the hardcoded hash becomes stale,
 *    blocking the browser from loading the script.
 * 2. The version query parameter stays the same across deploys, so
 *    browsers serve a cached old JS file that fails the new SRI check.
 *
 * The version is derived from the content hash so it changes automatically
 * whenever the bundle output changes.
 */
function updateSriHash() {
    const scriptPath = socketClientConfig.outfile;
    // Check both local dev path (../index.html) and Docker path (public/index.html)
    const candidates = [path.join(__dirname, '../index.html'), path.join(__dirname, 'public/index.html')];
    const indexPath = candidates.find((p) => fs.existsSync(p));

    if (!fs.existsSync(scriptPath) || !indexPath) {
        console.warn('SRI update skipped: missing socket-client.js or index.html');
        return;
    }

    const fileContents = fs.readFileSync(scriptPath);
    const hash = crypto.createHash('sha384').update(fileContents).digest('base64');
    const newIntegrity = `sha384-${hash}`;
    // Use first 8 hex chars of the hash as a content-based cache-bust version
    const contentVersion = crypto.createHash('sha384').update(fileContents).digest('hex').slice(0, 8);

    let html = fs.readFileSync(indexPath, 'utf8');
    const pattern = /(socket-client\.js\?v=)[A-Za-z0-9]+("\s+integrity=")sha384-[A-Za-z0-9+/=]+(")/;
    if (!pattern.test(html)) {
        console.warn('SRI update skipped: could not find socket-client.js integrity attribute in index.html');
        return;
    }

    html = html.replace(pattern, `$1${contentVersion}$2${newIntegrity}$3`);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log(`Updated socket-client.js: version=${contentVersion}, integrity=${newIntegrity}`);
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
        updateSriHash();
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
