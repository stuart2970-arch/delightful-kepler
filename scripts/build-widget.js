const esbuild = require('esbuild');

console.log('Building StyleFlo widget...');

esbuild.build({
  entryPoints: {
    'widget': 'src/widget/index.ts',
    'embed': 'src/widget/embed.ts'
  },
  bundle: true,
  minify: true,
  outdir: 'public',
  sourcemap: false,
  target: ['es2020'],
  platform: 'browser',
}).then(() => {
  console.log('Widget scripts compiled and minified successfully inside public/ folder.');
}).catch((err) => {
  console.error('Widget build failed:', err);
  process.exit(1);
});
