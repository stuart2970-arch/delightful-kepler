const { createGoogleGenerativeAI } = require('@ai-sdk/google');
const { streamText } = require('ai');
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY || 'dummy' });

async function test() {
  try {
    const result = await streamText({
      model: google('gemini-1.5-flash'),
      messages: [{ role: 'user', content: 'hello' }],
    });
    for await (const chunk of result.textStream) {
      console.log("CHUNK:", chunk);
    }
    console.log("SUCCESS");
  } catch (e) {
    console.log("ERROR:", e.message);
  }
}
test();
