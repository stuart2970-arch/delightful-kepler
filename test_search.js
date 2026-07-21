require('dotenv').config({ path: '.env.local' });
const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;

if (!apiKey) {
  console.log('NO API KEY CONFIGURED IN LOCAL ENV!');
} else {
  const q = 'StyleFlo & WP-123';
  const loc = '53.3954806,-2.8865454';
  const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&location=${loc}&radius=500&key=${apiKey}`;
  fetch(textSearchUrl).then(r=>r.json()).then(data => {
    console.log(JSON.stringify(data, null, 2));
  }).catch(e => console.error(e));
}
