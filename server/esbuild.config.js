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
 * Update the SRI integrity hash for socket-client.js in index.html.
 * This prevents the browser from blocking the script after a rebuild.
 */
function updateIntegrityHash() {
    const socketClientPath = path.join(__dirname, 'public/js/socket-client.js');
    const indexHtmlPath = path.join(__dirname, '..', 'index.html');

    if (!fs.existsSync(socketClientPath) || !fs.existsSync(indexHtmlPath)) {
        console.warn('Skipping integrity hash update: files not found');
        return;
    }

    const fileContent = fs.readFileSync(socketClientPath);
    const hash = crypto.createHash('sha384').update(fileContent).digest('base64');
    const newIntegrity = `sha384-${hash}`;

    let html = fs.readFileSync(indexHtmlPath, 'utf8');
    const pattern = /(<script defer src="\/js\/socket-client\.js\?v=)(\d+)(" integrity=")([^"]+)(")/;
    const match = html.match(pattern);

    if (!match) {
        console.warn('Skipping integrity hash update: script tag not found in index.html');
        return;
    }

    const currentIntegrity = match[4];
    if (currentIntegrity === newIntegrity) {
        console.log('SRI integrity hash is already up to date');
        return;
    }

    const currentVersion = parseInt(match[2], 10);
    html = html.replace(pattern, `$1${currentVersion + 1}$3${newIntegrity}$5`);
    fs.writeFileSync(indexHtmlPath, html, 'utf8');
    console.log(`Updated SRI integrity hash (v${currentVersion} -> v${currentVersion + 1})`);
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
        await Promise.all([
            esbuild.build(appConfig),
            esbuild.build(socketClientConfig),
        ]);
        updateIntegrityHash();
        console.log('Frontend bundle built successfully');
    }
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
