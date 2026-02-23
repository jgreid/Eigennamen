/**
 * esbuild configuration for frontend bundling
 *
 * Produces minified, bundled output for production.
 * The existing tsc build (build:frontend) remains for development with source maps.
 */
const esbuild = require('esbuild');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const isAnalyze = process.argv.includes('--analyze');

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
};

/**
 * Update the SRI integrity hash in index.html for socket-client.js.
 * This prevents the recurring bug where a rebuild changes the file
 * but the hardcoded hash in index.html becomes stale, blocking the
 * browser from loading the script.
 */
function updateSriHash() {
    const scriptPath = socketClientConfig.outfile;
    // Check both local dev path (../index.html) and Docker path (public/index.html)
    const candidates = [
        path.join(__dirname, '../index.html'),
        path.join(__dirname, 'public/index.html'),
    ];
    const indexPath = candidates.find(p => fs.existsSync(p));

    if (!fs.existsSync(scriptPath) || !indexPath) {
        console.warn('SRI update skipped: missing socket-client.js or index.html');
        return;
    }

    const fileContents = fs.readFileSync(scriptPath);
    const hash = crypto.createHash('sha384').update(fileContents).digest('base64');
    const newIntegrity = `sha384-${hash}`;

    let html = fs.readFileSync(indexPath, 'utf8');
    const pattern = /(socket-client\.js\?v=\d+"\s+integrity=")sha384-[A-Za-z0-9+/=]+(")/;
    if (!pattern.test(html)) {
        console.warn('SRI update skipped: could not find socket-client.js integrity attribute in index.html');
        return;
    }

    html = html.replace(pattern, `$1${newIntegrity}$2`);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log(`Updated SRI hash for socket-client.js: ${newIntegrity}`);
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
