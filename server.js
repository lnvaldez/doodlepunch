import express from "express";
import cors from "cors";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Log the API key length (never log the full key for security)
console.log(
  `API key loaded (length: ${process.env.OPENAI_API_KEY?.length || 0})`
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Test the OpenAI connection on startup
async function testOpenAIConnection() {
  try {
    console.log("Testing OpenAI connection...");
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: ["test"],
      encoding_format: "float",
    });
    console.log("OpenAI connection successful!");
  } catch (error) {
    console.error("OpenAI connection test failed:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
  }
}

testOpenAIConnection();

// Endpoint to evaluate guess similarity
app.post("/evaluate-guess", async (req, res) => {
  try {
    const { actualWord, guess } = req.body;

    // Get embeddings for both words
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: [actualWord, guess],
    });

    // Extract the embeddings
    const actualEmbedding = embeddingResponse.data[0].embedding;
    const guessEmbedding = embeddingResponse.data[1].embedding;

    // Calculate cosine similarity
    const similarity = cosineSimilarity(actualEmbedding, guessEmbedding);

    // Return the similarity score
    res.json({ similarity });
  } catch (error) {
    res.status(500).json({ error: `AI evaluation failed: ${error.message}` });
  }
});

// Helper function to calculate cosine similarity
function cosineSimilarity(a, b) {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
