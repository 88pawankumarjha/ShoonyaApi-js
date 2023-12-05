const OpenAI = require("openai");
require('dotenv').config();
const apiKey = process.env.OPENAI_API_KEY;

const openAI = new OpenAI({
  apiKey: apiKey,
});

async function main() {
  try {
    const completion = await openAI.chat.completions.create({
      messages: [{ role: "system", content: "You are a helpful assistant." }],
      model: "gpt-3.5-turbo",
    });

    console.log(completion.choices[0]);
  } catch (error) {
    if (error.response && error.response.status === 429) {
      console.error("Error: 429 You exceeded your current quota.");
    } else {
      console.error("Error:", error.message);
    }
  }
}

main();
