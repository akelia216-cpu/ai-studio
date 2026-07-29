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
// can write a non-verbal "acting only, no talking" scene instead of a spoken
// one (nonVerbal) for silent beats, and now also picks a camera movement per
// scene from the app's existing CAMERA_PRESETS list — including favoring a
// zoom-out/dolly-out reveal specifically for "both characters together"
// scenes (bothScene), since that's the one shot type only possible when the
// starting reference image already has both characters in it.
const { callLLM } = require("./_llm");
const { CAMERA_PRESETS } = require("./_models");

const DEFAULT_STYLE = "flat 2D cartoon animation style, soft rounded character design, bright warm color palette";
const CAMERA_KEYS = Object.keys(CAMERA_PRESETS);

function buildInstruction({ hasExpressionList, nonVerbal, bothScene }) {
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

  const cameraList = CAMERA_KEYS.map((k) => `${k} (${CAMERA_PRESETS[k].label})`).join(", ");

  // A scene only gets lip-synced afterward if someone is actually speaking in
  // it — a silent/non-verbal beat has no audio to sync, so the face-framing
  // constraint below doesn't apply to it at all. When someone IS speaking,
  // the face-detection step in lip-sync needs their face clearly visible in
  // the frame at the END of the clip too, not just the start — a zoom-out,
  // dolly-out, or orbit that leaves the speaker's face small, angled away, or
  // partially out of frame by the end of the shot will make lip-sync fail
  // even though the earlier part of the clip looked fine.
  const speakerFaceRule = nonVerbal
    ? ""
    : bothScene
    ? "IMPORTANT — lip-sync safety: this line gets lip-synced afterward, so the SPEAKING character's face must stay " +
      "clearly visible, reasonably large, and roughly facing the camera for the ENTIRE shot, including the very end " +
      "— never let their face end up small, angled away, or partially out of frame. This restriction is ONLY about " +
      "the speaking character, though: the other (non-speaking) character in frame doesn't need to stay " +
      "face-visible, so a pull-back/reveal shot is still fine as long as it's the speaker staying framed, not the " +
      "other character.\n"
    : "IMPORTANT — lip-sync safety: this line gets lip-synced afterward, so the character's face must stay clearly " +
      "visible, reasonably large, and roughly facing the camera for the ENTIRE shot, including the very end — never " +
      "let their face end up small, angled away, or partially out of frame by the end of the clip.\n";

  const cameraRule = bothScene
    ? `Also choose ONE camera movement from this list (by key): ${cameraList}. Since the starting reference image ` +
      "already shows BOTH characters together, this scene is a good candidate for \"zoom-out\" or \"dolly-out\" — " +
      "starting close on the speaker and pulling back to reveal the other character reacting — when the moment " +
      'actually calls for that kind of reveal. Don\'t force it though: pick "none" or another movement if a static ' +
      "or simpler shot fits better." +
      (nonVerbal
        ? "\n"
        : " Just make sure whichever movement you pick still keeps the SPEAKING character's face framed and " +
          "readable throughout, per the lip-sync safety rule above — the reveal is about uncovering the other " +
          "character, not about losing the speaker.\n")
    : `Also choose ONE camera movement from this list (by key): ${cameraList}. The starting reference image only ` +
      "shows this one character alone, so do NOT choose a movement that implies revealing or panning to another " +
      'character who isn\'t in frame — pick "none" for a static shot unless a simple push/pan/zoom clearly fits.' +
      (nonVerbal
        ? "\n"
        : " Zoom-out, dolly-out, and orbit are only safe here if the character's face stays clearly readable " +
          "throughout per the lip-sync safety rule above — if you're not sure a movement keeps the face readable " +
          'the whole way through, prefer "zoom-in", "none", or a gentle pan instead.\n');

  return (
    "You write ONE vivid prompt for an AI image-to-video model that animates one or two cartoon characters from a " +
    "starting reference image, for children's cartoon content.\n\n" +
    `Given the character(s) and the ${nonVerbal ? "action/stage direction" : "line they're saying"}, do all of the following:\n` +
    "1. Have the character actually perform whatever physical action is described (e.g. if it's about throwing a " +
    `rock, show the wind-up and throw) ${nonVerbal ? "" : "instead of just standing there talking"}.\n` +
    "2. Background/setting: if a fixed setting is given below, use that exact setting for this scene (only adjust " +
    "camera framing, not the location) — otherwise invent a specific, simple setting/background matching the " +
    "content and mood (2-4 concrete elements), varied from a generic backdrop.\n" +
    "3. ALWAYS include, no matter what: a medium shot, front-facing or three-quarter camera clearly showing the " +
    `character's whole upper body and face (never a tight close-up); ${talkingRule} natural blinking; the exact ` +
    "visual/art style given below (do not substitute a different art style); a cheerful, gentle mood" +
    (bothScene
      ? "; the other character is visibly present in frame too, reacting to what's happening but not talking.\n"
      : "; no other characters in frame.\n") +
    expressionRule +
    speakerFaceRule +
    cameraRule +
    "\n" +
    "Respond in EXACTLY this format (nothing else, one line each except PROMPT which is the final 3-5 sentences):\n" +
    (hasExpressionList ? 'EXPRESSION: <name from the list, or "default">\n' : "") +
    "CAMERA: <key from the camera list above>\n" +
    "PROMPT: <the finished scene prompt>"
  );
}

function parseReply(text, hasExpressionList) {
  const promptMatch = text.match(/PROMPT:\s*([\s\S]+)/i);
  if (!promptMatch) {
    // The model didn't follow the format — fall back to treating the whole
    // reply as the prompt rather than failing the scene outright.
    return { prompt: text.replace(/^"|"$/g, "").trim(), matchedExpression: null, cameraMotion: "none" };
  }

  const exprMatch = text.match(/EXPRESSION:\s*([^\n]+)/i);
  const cameraMatch = text.match(/CAMERA:\s*([^\n]+)/i);
  const rawCamera = cameraMatch ? cameraMatch[1].trim().toLowerCase().replace(/^"|"$/g, "") : "none";

  return {
    prompt: promptMatch[1].replace(/^"|"$/g, "").trim(),
    matchedExpression: hasExpressionList && exprMatch ? exprMatch[1].trim().toLowerCase().replace(/^"|"$/g, "") : null,
    cameraMotion: CAMERA_KEYS.includes(rawCamera) ? rawCamera : "none",
  };
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
    bothScene, // true when this scene uses the "both characters together" reference image
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
  if (bothScene) userTextParts.push("Both characters are together in the starting reference image for this scene.");
  userTextParts.push(`${nonVerbal ? "Action/stage direction" : "Line"}: "${lineText}"`);

  try {
    const instruction = buildInstruction({ hasExpressionList, nonVerbal: !!nonVerbal, bothScene: !!bothScene });
    const reply = await callLLM(token, instruction, userTextParts.join("\n"), 340);
    const { prompt, matchedExpression, cameraMotion } = parseReply(reply, hasExpressionList);
    if (!prompt) throw new Error("The model returned an empty scene prompt.");
    res.status(200).json({ prompt, matchedExpression, cameraMotion });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Couldn't build a scene prompt." });
  }
};
