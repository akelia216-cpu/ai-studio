const { callLLM } = require("./_llm");

const INSTRUCTIONS = {
  image:
    "You rewrite short image prompts into vivid, detailed prompts for an AI image generator. " +
    "Keep the user's subject and intent exactly the same — add concrete visual detail: lighting, " +
    "composition, camera/lens feel, color palette, mood, and style. 2-3 sentences max. " +
    "Return ONLY the rewritten prompt, no preamble, no quotes.",
  video:
    "You rewrite short video prompts into vivid, detailed prompts for an AI video generator. " +
    "Keep the user's subject and intent exactly the same — add concrete detail about motion, " +
    "camera behavior, lighting, and atmosphere. 2-3 sentences max. " +
    "Return ONLY the rewritten prompt, no preamble, no quotes.",
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const token = process.env.FAL_KEY;
  if (!token) {
    res.status(500).json({ error: "Server is missing FAL_KEY." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const { prompt, kind } = body;
  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }

  try {
    let text = await callLLM(token, INSTRUCTIONS[kind] || INSTRUCTIONS.image, prompt.trim(), 180);
    text = text.replace(/^"|"$/g, "").trim();

    if (!text) {
      res.status(200).json({ enhancedPrompt: prompt, note: "Model returned nothing usable; kept your original prompt." });
      return;
    }

    res.status(200).json({ enhancedPrompt: text });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Unexpected server error." });
  }
};
