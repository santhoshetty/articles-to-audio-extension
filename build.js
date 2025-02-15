import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['popup.js'],
  bundle: true,
  outfile: 'dist/popup.bundle.js',
  format: 'iife',
  platform: 'browser',
  target: ['chrome58'],
  loader: { '.js': 'jsx' },
  minify: true,
}); 