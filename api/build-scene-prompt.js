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
// one (nonVerbal) for silent beats, and picks a camera movement per scene
// from the app's CAMERA_PRESETS list — favoring a zoom-out/dolly-out reveal
// for "both characters together" scenes (bothScene) that AREN'T also
// getting lip-synced, since that's the one shot type only possible when the
// starting reference image already has both characters in it.
//
// Camera motion and lip-sync do NOT mix safely: a zoom-out, dolly-out, or
// orbit shot can leave a speaking character's face small, angled away, or
// out of frame by the end of the clip, which fails lip-sync's face
// detection — this was confirmed as a real, repeatable failure (not a
// one-off) across THREE separate scenes and on BOTH lip-sync engines
// (LatentSync and native Kling), ruling out the engine as the cause. A soft
// "please avoid this" instruction to the LLM wasn't reliable enough to stop
// it happening again, so this is now a HARD constraint: for any scene that
// will actually be lip-synced (any non-silent line — solo or the speaking
// half of a "both" scene), the risky motions are removed from the candidate
// list given to the LLM entirely, and the parsed response is re-validated
// server-side against that same restricted list, falling back to "none" if
// the model somehow returns one anyway. Only a scene with NO lip-sync at
// all (a silent `[Name: action]` or `[Both: action]` beat) gets the full
// camera-motion list, including the reveal-shot options.
const { callLLM } = require("./_llm");
const { CAMERA_PRESETS } = require("./_models");

const DEFAULT_STYLE = "flat 2D cartoon animation style, soft rounded character design, bright warm color palette";
const CAMERA_KEYS = Object.keys(CAMERA_PRESETS);

// The only camera moves allowed on a scene that will be lip-synced — no
// zoom-out, dolly-out, or orbit, since those are the ones observed to break
// face detection by the end of the clip. Filtered against CAMERA_KEYS so a
// future rename/removal in _models.js can't silently offer a stale key.
const LIPSYNC_SAFE_CAMERA_KEYS = ["none", "zoom-in", "pan-left", "pan-right"].filter((k) => CAMERA_KEYS.includes(k));

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

  // Whether this scene gets lip-synced at all — true for ANY spoken line,
  // whether solo or the speaking half of a "both" scene. Silent beats
  // (nonVerbal) never lip-sync, regardless of bothScene.
  const willLipSync = !nonVerbal;
  const availableCameraKeys = willLipSync ? LIPSYNC_SAFE_CAMERA_KEYS : CAMERA_KEYS;
  const cameraList = availableCameraKeys.map((k) => `${k} (${CAMERA_PRESETS[k].label})`).join(", ");

  let cameraRule;
  if (willLipSync) {
    // Hard-restricted list — no reveal/pull-back options exist here at all,
    // so there's nothing to warn the model away from; it can only pick from
    // what's actually offered. This applies even to a "(both)"-tagged
    // speaking line: the SPEAKER still needs to survive lip-sync, so that
    // scene doesn't get the reveal treatment either — only a fully silent
    // "[Both: action]" beat (nonVerbal, handled below) still gets it.
    cameraRule =
      `Also choose ONE camera movement from this list (by key): ${cameraList}. This is the FULL list of allowed ` +
      "movements for this scene — no other options exist, because this line gets lip-synced afterward and a " +
      "zoom-out, dolly-out, or orbit risks leaving the speaking character's face too small, turned away, or out of " +
      'frame by the end of the shot, which breaks lip-sync. Pick "none" for a static shot unless a simple zoom-in ' +
      "or gentle pan clearly fits the moment — every option in the list keeps the character's face clearly readable " +
      "throughout.\n";
  } else if (bothScene) {
    cameraRule =
      `Also choose ONE camera movement from this list (by key): ${cameraList}. Since the starting reference image ` +
      "already shows BOTH characters together AND this beat is silent (nothing gets lip-synced here), this scene " +
      'is a good candidate for "zoom-out" or "dolly-out" — starting close on one character and pulling back to ' +
      'reveal the other reacting — when the moment actually calls for that kind of reveal. Pick "none" or another ' +
      "movement if a static or simpler shot fits better.\n";
  } else {
    cameraRule =
      `Also choose ONE camera movement from this list (by key): ${cameraList}. The starting reference image only ` +
      "shows this one character alone, so do NOT choose a movement that implies revealing or panning to another " +
      'character who isn\'t in frame — pick "none" for a static shot unless a simple push/pan/zoom clearly fits.\n';
  }

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
    cameraRule +
    "\n" +
    "Respond in EXACTLY this format (nothing else, one line each except PROMPT which is the final 3-5 sentences):\n" +
    (hasExpressionList ? 'EXPRESSION: <name from the list, or "default">\n' : "") +
    "CAMERA: <key from the camera list above>\n" +
    "PROMPT: <the finished scene prompt>"
  );
}

function parseReply(text, hasExpressionList, allowedCameraKeys) {
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
    // Re-validated against the SAME restricted list the model was given for
    // this scene (not the full CAMERA_KEYS) — this is what makes the
    // restriction an actual hard constraint rather than just a shorter
    // suggestion: even if the model ignores its instructions and names a
    // disallowed key (e.g. "zoom-out" on a lip-synced scene), it gets
    // overridden to "none" here rather than passed through to /api/generate.
    cameraMotion: allowedCameraKeys.includes(rawCamera) ? rawCamera : "none",
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
  const willLipSync = !nonVerbal;
  const allowedCameraKeys = willLipSync ? LIPSYNC_SAFE_CAMERA_KEYS : CAMERA_KEYS;

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
    const { prompt, matchedExpression, cameraMotion } = parseReply(reply, hasExpressionList, allowedCameraKeys);
    if (!prompt) throw new Error("The model returned an empty scene prompt.");
    res.status(200).json({ prompt, matchedExpression, cameraMotion });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Couldn't build a scene prompt." });
  }
};
