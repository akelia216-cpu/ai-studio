// Uses the shared small LLM (see _llm.js) to decide whether one line of
// dialogue/narration, or a scene description, implies a distinct sound
// effect — a rock being thrown and hitting something, a door slamming,
// footsteps, a splash, glass breaking, thunder, an engine starting — and if
// so returns a short text description suitable for generating that sound.
// This is what lets sound effects get added automatically, without the user
// having to tag every line by hand (they can still override with an
// explicit [sfx: ...] tag in the script, handled client-side before this is
// ever called).
const { callLLM } = require("./_llm");

const INSTRUCTION =
  "You read one short line of dialogue, narration, or a video scene description. Decide whether it depicts " +
  "a distinct physical action that would make a noticeable, specific sound effect — for example throwing or " +
  "hitting an object, a door slamming, footsteps, a splash, glass breaking, thunder, an engine starting. " +
  "Ordinary talking, walking calmly, or quiet emotional moments do NOT count. " +
  'If there IS a clear sound-effect-worthy action, reply with ONLY a short 3-8 word sound description suitable ' +
  'for generating that exact sound effect (e.g. "a rock hitting a wooden fence"). ' +
  "If there is no such action, reply with exactly the single word: NONE. " +
  "Never invent an action that isn't stated or clearly implied by the text. Reply with nothing else — no quotes, no explanation.";

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

  const { text } = body;
  if (!text || !text.trim()) {
    res.status(400).json({ error: "text is required." });
    return;
  }

  try {
    let reply = await callLLM(token, INSTRUCTION, text.trim(), 40);
    reply = reply.replace(/^"|"$/g, "").trim();
    const sfx = reply && reply.toUpperCase() !== "NONE" ? reply : null;
    res.status(200).json({ sfx });
  } catch (err) {
    // A failed detection call shouldn't break the whole video — just report
    // no sound effect for this line rather than surfacing a hard error that
    // would abort generation over a nice-to-have feature.
    res.status(200).json({ sfx: null, note: err.message || "Detection failed." });
  }
};
