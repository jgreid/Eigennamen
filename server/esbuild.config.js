/**
 * esbuild configuration for frontend bundling
 *
 * Produces minified, bundled output for production.
 * The existing tsc build (build:frontend) remains for development with source maps.
 */
const esbuild = require('esbuild');
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
        console.log('Frontend bundle built successfully');
    }
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
