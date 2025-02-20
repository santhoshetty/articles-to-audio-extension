import * as esbuild from 'esbuild';

// Common build options
const commonOptions = {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome58'],
    loader: { '.js': 'jsx' },
    minify: true,
};

// Build all entry points
await Promise.all([
    // Popup
    esbuild.build({
        ...commonOptions,
        entryPoints: ['popup.js'],
        outfile: 'dist/popup.bundle.js',
    }),
    
    // Articles page
    esbuild.build({
        ...commonOptions,
        entryPoints: ['articles.js'],
        outfile: 'dist/articles.bundle.js',
    }),
    
    // Background script
    esbuild.build({
        ...commonOptions,
        entryPoints: ['background.js'],
        outfile: 'dist/background.bundle.js',
    }),
    
    // Content script
    esbuild.build({
        ...commonOptions,
        entryPoints: ['contentScript.js'],
        outfile: 'dist/contentScript.bundle.js',
    }),
    
    // Options page
    esbuild.build({
        ...commonOptions,
        entryPoints: ['options.js'],
        outfile: 'dist/options.bundle.js',
    })
]); 