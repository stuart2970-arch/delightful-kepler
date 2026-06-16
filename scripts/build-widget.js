const esbuild = require('esbuild');

console.log('Building StyleFlo widget...');

esbuild.build({
  entryPoints: ['src/widget/index.ts'],
  bundle: true,
  minify: true,
  outfile: 'public/widget.js',
  sourcemap: false,
  target: ['es2020'],
  platform: 'browser',
}).then(() => {
  console.log('widget.js compiled and minified successfully inside public/ folder.');
}).catch((err) => {
  console.error('Widget build failed:', err);
  process.exit(1);
});
