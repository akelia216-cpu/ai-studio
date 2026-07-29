// Turns one line of a narration/dialogue script into a full scene prompt for
// the image-to-video model: has the character actually perform whatever
// action the line describes (instead of just standing there talking) and
// invents a specific background/setting to match it, while always keeping
// the framing/mouth-movement requirements the later lip-sync step depends
// on. This replaces the old fixed/generic scene prompts (same backyard,
// same handful of canned gestures every time) with one written fresh per
// line by a small LLM (see _llm.js).
const { callLLM } = require("./_llm");

const INSTRUCTION =
  "You write ONE vivid prompt for an AI image-to-video model that animates a single cartoon character from a " +
  "starting reference image, for children's cartoon content.\n\n" +
  "Given the character and the line they're saying, do all of the following:\n" +
  "1. Have the character actually perform whatever physical action the line implies (e.g. if the line is about " +
  "throwing a rock, show the wind-up and throw) instead of just standing there talking.\n" +
  "2. Invent a specific, simple setting/background that matches the line's content and mood (2-4 concrete " +
  "background elements), rather than a generic backdrop — vary it line to line instead of reusing one place.\n" +
  "3. ALWAYS include, no matter what: a medium shot, front-facing or three-quarter camera clearly showing the " +
  "character's whole upper body and face (never a tight close-up); the character's mouth moving naturally and " +
  "continuously in a clear speaking rhythm the entire time (this scene gets lip-synced to spoken audio " +
  "afterward, so continuous mouth movement is essential even while the character is acting); natural blinking; " +
  "flat 2D cartoon animation style with soft rounded character design and a bright warm color palette; a " +
  "cheerful, gentle, preschool-TV-show mood; no other characters in frame.\n\n" +
  "Write 3-5 sentences. Return ONLY the finished prompt — no preamble, no quotes, no bullet points, no labels.";

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

  const { characterName, characterDescription, lineText, expression } = body;
  if (!characterName || !lineText) {
    res.status(400).json({ error: "characterName and lineText are required." });
    return;
  }

  const userTextParts = [`Character: ${characterName}${characterDescription ? ` — ${characterDescription}` : ""}`];
  if (expression && expression !== "default") userTextParts.push(`Current expression/mood: ${expression}`);
  userTextParts.push(`Line: "${lineText}"`);

  try {
    let prompt = await callLLM(token, INSTRUCTION, userTextParts.join("\n"), 260);
    prompt = prompt.replace(/^"|"$/g, "").trim();
    if (!prompt) throw new Error("The model returned an empty scene prompt.");
    res.status(200).json({ prompt });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Couldn't build a scene prompt." });
  }
};
