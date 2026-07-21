const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const match = env.match(/GOOGLE_MAPS_API_KEY=(.*)/) || env.match(/GOOGLE_PLACES_API_KEY=(.*)/);
const apiKey = match ? match[1].trim() : null;

if (!apiKey) {
  console.log('NO API KEY CONFIGURED IN LOCAL ENV!');
} else {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.addressComponents'
    },
    body: JSON.stringify({
      textQuery: 'StyleFlo & WP-123',
      locationBias: {
        circle: {
          center: { latitude: 53.3954806, longitude: -2.8865454 },
          radius: 500.0
        }
      }
    })
  })
  .then(r => r.json())
  .then(data => {
    console.log(JSON.stringify(data, null, 2));
  }).catch(e => console.error(e));
}
