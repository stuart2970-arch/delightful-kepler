

async function test() {
  try {
    const res = await fetch('http://localhost:3000/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        chatbotId: 'test-id',
        sessionId: 'test-session'
      })
    });
    
    console.log('Status:', res.status);
    console.log('Headers:', res.headers.raw());
    
    const text = await res.text();
    console.log('Body length:', text.length);
    console.log('Body:', text);
  } catch (err) {
    console.error(err);
  }
}
test();
