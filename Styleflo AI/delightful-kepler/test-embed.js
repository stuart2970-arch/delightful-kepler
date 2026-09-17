const { createGoogleGenerativeAI } = require('@ai-sdk/google');
const { embed } = require('ai');
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  try {
    const { embedding } = await embed({
      model: google.textEmbeddingModel('text-embedding-004'),
      value: "hello world"
    });
    console.log("SUCCESS:", embedding.length);
  } catch (e) {
    console.log("ERROR:", e.message);
  }
}
test();
