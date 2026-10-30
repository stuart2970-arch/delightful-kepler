const esbuild = require('esbuild');

console.log('Building StyleFlo widget...');

// STYL-226: bake NEXT_PUBLIC_TURNSTILE_SITE_KEY when present. No production fallback.
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';

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
  define: {
    'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': JSON.stringify(turnstileSiteKey),
  },
}).then(() => {
  console.log('Widget scripts compiled and minified successfully inside public/ folder.');
}).catch((err) => {
  console.error('Widget build failed:', err);
  process.exit(1);
});
