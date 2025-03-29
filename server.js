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
    console.log(`Evaluating: "${actualWord}" vs "${guess}"`);

    // If exact match, return 3 points immediately
    if (guess.toLowerCase() === actualWord.toLowerCase()) {
      console.log("Exact match! 3 points");
      return res.json({ points: 3, similarity: 1.0 });
    }

    // Get embeddings for both words
    console.log("Requesting embeddings from OpenAI...");
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [actualWord, guess],
      encoding_format: "float",
    });

    // Extract the embeddings
    const actualEmbedding = embeddingResponse.data[0].embedding;
    const guessEmbedding = embeddingResponse.data[1].embedding;

    // Calculate cosine similarity
    const similarity = cosineSimilarity(actualEmbedding, guessEmbedding);
    console.log(`Similarity: ${similarity.toFixed(4)}`);

    // Assign points based on similarity
    let points = 0;
    if (similarity >= 0.85) {
      points = 2;
    } else if (similarity >= 0.65) {
      points = 1;
    }
    console.log(`Points awarded: ${points}`);

    res.json({ points, similarity });
  } catch (error) {
    console.error("AI Evaluation Error:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
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
