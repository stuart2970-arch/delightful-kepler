const esbuild = require('esbuild');

console.log('Building StyleFlo widget...');

// STYL-203: bake NEXT_PUBLIC_TURNSTILE_SITE_KEY when present (App Hosting BUILD
// injects the staging always-pass site key). Fall back to the live site key.
const turnstileSiteKey =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '0x4AAAAAAEcGPat6Ll-AhKbf';

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
