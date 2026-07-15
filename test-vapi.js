const fetch = require('node-fetch');

async function test() {
  try {
    const res = await fetch('http://localhost:3000/api/voice/00000000-0000-0000-0000-000000000000/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-1.5-flash',
        stream: true,
        messages: [
          { role: 'system', content: 'You are a test.' },
          { role: 'user', content: 'Hello!' }
        ]
      })
    });
    
    console.log('Status:', res.status);
    console.log('Headers:', res.headers.raw());
    
    if (res.ok) {
        const text = await res.text();
        console.log('Response body:', text);
    } else {
        console.error('Error response:', await res.text());
    }
  } catch(e) {
    console.error(e);
  }
}
test();
