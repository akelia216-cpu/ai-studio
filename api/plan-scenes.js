const { callLLM } = require("./_llm");

const MAX_SCENES = 30; // hard cap so a long request can't runaway into huge cost/time

function buildInstruction(numScenes, style) {
  const styleNote =
    style === "ugc"
      ? " Every scene should read as an authentic, unpolished, smartphone-shot user-generated clip, not a polished studio production."
      : "";
  return (
    `You are a storyboard writer for short AI-generated video clips. Given a topic, break it into ` +
    `exactly ${numScenes} sequential scenes that together cover the topic as a continuous, coherent ` +
    `piece (documentary, tutorial, story, or whatever fits the topic best). Each scene becomes its own ` +
    `~5 second AI-generated video clip, so each description must: be 1-2 sentences, describe a single ` +
    `continuous shot (one action/camera move, not a sequence of cuts), and repeat any recurring ` +
    `character/setting/style details so the description stands alone (the video generator has no memory ` +
    `of other scenes).${styleNote}\n\n` +
    `Return ONLY a JSON array of exactly ${numScenes} strings, nothing else — no numbering, no markdown, ` +
    `no explanation. Example shape: ["scene one text", "scene two text"]`
  );
}

function parseScenes(text, numScenes) {
  // Try straight JSON first.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed;
  } catch {
    // fall through
  }

  // Try to find the first [...] block in the text.
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed;
    } catch {
      // fall through
    }
  }

  // Last resort: treat each non-empty line as one scene, stripping leading
  // numbering/bullets/quotes.
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").replace(/^"|"$/g, "").trim())
    .filter(Boolean);

  if (lines.length > 0) return lines;

  return null;
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

  const { topic, totalSeconds, perSceneSeconds, style } = body;

  if (!topic || !topic.trim()) {
    res.status(400).json({ error: "A topic/prompt is required." });
    return;
  }

  const perScene = Number(perSceneSeconds) || 5;
  const total = Number(totalSeconds) || 30;
  const numScenes = Math.min(MAX_SCENES, Math.max(1, Math.round(total / perScene)));

  try {
    const instruction = buildInstruction(numScenes, style);
    const text = await callLLM(token, instruction, topic.trim(), 1200);
    const scenes = parseScenes(text, numScenes);

    if (!scenes || scenes.length === 0) {
      res.status(502).json({ error: "Couldn't turn that topic into a scene list — try rephrasing it or a shorter length." });
      return;
    }

    // Trim down to the requested count if the model overshot — it's fine if
    // it undershoots instead (returns fewer scenes than asked); every caller
    // already derives its scene count from the returned array's actual
    // length rather than assuming it matches numScenes exactly.
    const finalScenes = scenes.slice(0, numScenes);

    res.status(200).json({ scenes: finalScenes, perSceneSeconds: perScene });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Unexpected server error." });
  }
};
