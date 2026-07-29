// Turns one line of a narration/dialogue script into a full scene prompt for
// the image-to-video model: has the character actually perform whatever
// action the line describes (instead of just standing there talking) and
// invents a specific background/setting to match it (unless a fixed one was
// given), while always keeping the framing/mouth-movement requirements the
// later lip-sync step depends on. This replaces the old fixed/generic scene
// prompts (same backyard, same handful of canned gestures every time) with
// one written fresh per line by a small LLM (see _llm.js).
//
// It can also pick which of the character's uploaded expression images best
// fits a line that wasn't explicitly tagged in the script (availableExpressions),
// and can write a non-verbal "acting only, no talking" scene instead of a
// spoken one (nonVerbal) for silent beats.
const { callLLM } = require("./_llm");

const DEFAULT_STYLE = "flat 2D cartoon animation style, soft rounded character design, bright warm color palette";

function buildInstruction({ hasExpressionList, nonVerbal }) {
  const talkingRule = nonVerbal
    ? "This is a SILENT, non-verbal beat — the character is NOT talking. Do not describe any talking or mouth movement; " +
      "just the physical action/reaction itself, with a natural closed or resting mouth unless the action itself " +
      "involves an expression like gasping."
    : "the character's mouth moving naturally and continuously in a clear speaking rhythm the entire time (this " +
      "scene gets lip-synced to spoken audio afterward, so continuous mouth movement is essential even while the " +
      "character is acting);";

  const expressionRule = hasExpressionList
    ? "Also choose which ONE expression from the provided list best fits this moment (or \"default\" if none fit " +
      "better than the default look) — pick based on the emotional content of the line, not just literally-stated " +
      "feelings.\n"
    : "";

  return (
    "You write ONE vivid prompt for an AI image-to-video model that animates a single cartoon character from a " +
    "starting reference image, for children's cartoon content.\n\n" +
    `Given the character and the ${nonVerbal ? "action/stage direction" : "line they're saying"}, do all of the following:\n` +
    "1. Have the character actually perform whatever physical action is described (e.g. if it's about throwing a " +
    `rock, show the wind-up and throw) ${nonVerbal ? "" : "instead of just standing there talking"}.\n` +
    "2. Background/setting: if a fixed setting is given below, use that exact setting for this scene (only adjust " +
    "camera framing, not the location) — otherwise invent a specific, simple setting/background matching the " +
    "content and mood (2-4 concrete elements), varied from a generic backdrop.\n" +
    "3. ALWAYS include, no matter what: a medium shot, front-facing or three-quarter camera clearly showing the " +
    `character's whole upper body and face (never a tight close-up); ${talkingRule} natural blinking; the exact ` +
    "visual/art style given below (do not substitute a different art style); a cheerful, gentle mood; no other " +
    "characters in frame.\n" +
    expressionRule +
    "\n" +
    (hasExpressionList
      ? 'Respond in EXACTLY this two-line format (nothing else):\nEXPRESSION: <name from the list, or "default">\nPROMPT: <the finished 3-5 sentence scene prompt>'
      : "Write 3-5 sentences. Return ONLY the finished prompt — no preamble, no quotes, no bullet points, no labels.")
  );
}

function parseReply(text, hasExpressionList) {
  if (!hasExpressionList) return { prompt: text.replace(/^"|"$/g, "").trim(), matchedExpression: null };

  const exprMatch = text.match(/EXPRESSION:\s*([^\n]+)/i);
  const promptMatch = text.match(/PROMPT:\s*([\s\S]+)/i);
  if (promptMatch) {
    return {
      prompt: promptMatch[1].replace(/^"|"$/g, "").trim(),
      matchedExpression: exprMatch ? exprMatch[1].trim().toLowerCase().replace(/^"|"$/g, "") : null,
    };
  }
  // The model didn't follow the two-line format — fall back to treating the
  // whole reply as the prompt rather than failing the scene outright.
  return { prompt: text.replace(/^"|"$/g, "").trim(), matchedExpression: null };
}

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

  const {
    characterName,
    characterDescription,
    lineText,
    expression,
    styleDescription,
    backgroundDescription,
    availableExpressions, // string[] of the character's other uploaded expression names, for auto-matching
    nonVerbal, // true for a silent action beat (no dialogue, no lip sync)
  } = body;
  if (!characterName || !lineText) {
    res.status(400).json({ error: "characterName and lineText are required." });
    return;
  }

  const hasExpressionList = Array.isArray(availableExpressions) && availableExpressions.length > 0;

  const userTextParts = [`Character: ${characterName}${characterDescription ? ` — ${characterDescription}` : ""}`];
  if (expression && expression !== "default") userTextParts.push(`Current/tagged expression: ${expression}`);
  if (hasExpressionList) userTextParts.push(`Available expressions to choose from: ${availableExpressions.join(", ")}, default`);
  userTextParts.push(`Art style to use: ${(styleDescription && styleDescription.trim()) || DEFAULT_STYLE}`);
  userTextParts.push(
    backgroundDescription && backgroundDescription.trim()
      ? `Fixed setting to use for every scene: ${backgroundDescription.trim()}`
      : "No fixed setting given — invent one matching this moment."
  );
  userTextParts.push(`${nonVerbal ? "Action/stage direction" : "Line"}: "${lineText}"`);

  try {
    const instruction = buildInstruction({ hasExpressionList, nonVerbal: !!nonVerbal });
    const reply = await callLLM(token, instruction, userTextParts.join("\n"), 320);
    const { prompt, matchedExpression } = parseReply(reply, hasExpressionList);
    if (!prompt) throw new Error("The model returned an empty scene prompt.");
    res.status(200).json({ prompt, matchedExpression });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Couldn't build a scene prompt." });
  }
};
