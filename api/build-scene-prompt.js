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
// it happening again, so this was made a HARD constraint: for any scene that
// will actually be lip-synced via the old animate-then-lip-sync pipeline,
// the risky motions are removed from the candidate list given to the LLM
// entirely, and the parsed response is re-validated server-side against that
// same restricted list, falling back to "none" if the model somehow returns
// one anyway. Only a scene with NO lip-sync at all (a silent
// `[Name: action]` or `[Both: action]` beat) gets the full camera-motion
// list, including the reveal-shot options.
//
// skipCameraMotion (new): Dialogue mode's spoken lines no longer go through
// that animate-then-lip-sync pipeline at all — they call Kling's AI Avatar
// v2 model directly (see /api/ai-avatar), which has no camera-motion
// parameter of any kind on its live schema. Camera motion is therefore
// meaningless for those lines, not just risky — so callers set
// skipCameraMotion:true for them, which removes the CAMERA question from
// the LLM prompt entirely (no list, no "CAMERA:" line in the response
// format) rather than restricting it to a safe subset. Silent beats always
// leave this false and are completely unaffected, and other callers
// (Cartoon Narration, which still uses the old two-step pipeline) also leave
// it false/omitted and keep the existing lipsync-safe restricted list.
const { callLLM } = require("./_llm");
const { CAMERA_PRESETS } = require("./_models");

// Merged in from the former api/enhance-prompt.js (2026-07) — Vercel's Hobby
// plan caps a deployment at 12 serverless functions (one per file in api/,
// excluding "_"-prefixed shared helpers), and adding api/ai-avatar.js pushed
// the project over that cap. enhance-prompt.js was picked to fold into this
// file specifically because both do the exact same basic job (ask the LLM to
// write a better prompt) and both already depend only on callLLM — the
// lowest-risk merge available. Dispatched via `action: "enhance"` in the
// request body; every other request (no `action` field) falls through to
// the original scene-prompt behavior below, unchanged.
// Fixes a real, confirmed continuity bug: every scene's visual prompt used
// to be written completely independently (one LLM call per line, no shared
// state at all), so when a script has a vague object referenced across
// multiple lines — "I found something over here!" ... "What did you find?"
// ... "they lean in to look closer" — each scene invented its own idea of
// what that object looked like, with zero memory of what an earlier scene
// already decided. This pre-pass reads the WHOLE script once, up front,
// and decides on ONE concrete visual description for any such object,
// which every per-scene call below is then given as a fixed constraint
// (see "Established visual details" in userTextParts) instead of inventing
// its own. Dispatched via `action: "establish-context"`, called once by the
// client before any per-scene prompt calls, same merge pattern as "enhance".
const ESTABLISH_CONTEXT_INSTRUCTION =
  "You are given the full sequence of lines from a short video script, in order, one per line and numbered. " +
  "Identify any physical object, item, or prop that is mentioned, discovered, held, or referred to across MORE " +
  "THAN ONE line — especially a vague reference like \"something\" or \"it\" that gets picked up or found in one " +
  "line and referred back to in later lines — because that object needs to look VISUALLY IDENTICAL every time it " +
  "appears on screen, and right now each line would otherwise be illustrated completely independently with no " +
  "shared memory between them. " +
  "For each such object, invent exactly ONE concrete, specific, simple, child-friendly visual description — " +
  "shape, color, size, material, 6-14 words — and commit to it. If a line only vaguely names the object " +
  '("something", "it"), you must still invent one concrete option and use that same description for every ' +
  "line that refers to it. Ignore objects that only ever appear in a single line — those don't need this. " +
  "If nothing in the script needs this kind of cross-line continuity, reply with exactly the single word: NONE.\n\n" +
  "Respond in EXACTLY this format, one object per line, nothing else:\n" +
  "<short reference name>: <concrete visual description>";

const ENHANCE_INSTRUCTIONS = {
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

const DEFAULT_STYLE = "flat 2D cartoon animation style, soft rounded character design, bright warm color palette";
const CAMERA_KEYS = Object.keys(CAMERA_PRESETS);

// The only camera moves allowed on a scene that will be lip-synced — no
// zoom-out, dolly-out, or orbit, since those are the ones observed to break
// face detection by the end of the clip. Filtered against CAMERA_KEYS so a
// future rename/removal in _models.js can't silently offer a stale key.
const LIPSYNC_SAFE_CAMERA_KEYS = ["none", "zoom-in", "pan-left", "pan-right"].filter((k) => CAMERA_KEYS.includes(k));

function buildInstruction({ hasExpressionList, nonVerbal, bothScene, skipCameraMotion }) {
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

  let cameraRule = "";
  if (!skipCameraMotion) {
    const availableCameraKeys = willLipSync ? LIPSYNC_SAFE_CAMERA_KEYS : CAMERA_KEYS;
    const cameraList = availableCameraKeys.map((k) => `${k} (${CAMERA_PRESETS[k].label})`).join(", ");

    if (willLipSync) {
      // Hard-restricted list — no reveal/pull-back options exist here at
      // all, so there's nothing to warn the model away from; it can only
      // pick from what's actually offered. This applies even to a
      // "(both)"-tagged speaking line: the SPEAKER still needs to survive
      // lip-sync, so that scene doesn't get the reveal treatment either —
      // only a fully silent "[Both: action]" beat (nonVerbal, handled
      // below) still gets it. (This branch is only reachable when a caller
      // still uses the old animate-then-lip-sync pipeline for a spoken
      // line — Dialogue mode's spoken lines now set skipCameraMotion
      // instead, since they don't go through that pipeline at all.)
      cameraRule =
        `Also choose ONE camera movement from this list (by key): ${cameraList}. This is the FULL list of allowed ` +
        "movements for this scene — no other options exist, because this line gets lip-synced afterward and a " +
        "zoom-out, dolly-out, or orbit risks leaving the speaking character's face too small, turned away, or out " +
        'of frame by the end of the shot, which breaks lip-sync. Pick "none" for a static shot unless a simple ' +
        "zoom-in or gentle pan clearly fits the moment — every option in the list keeps the character's face " +
        "clearly readable throughout.\n";
    } else if (bothScene) {
      cameraRule =
        `Also choose ONE camera movement from this list (by key): ${cameraList}. Since the starting reference ` +
        "image already shows BOTH characters together AND this beat is silent (nothing gets lip-synced here), " +
        'this scene is a good candidate for "zoom-out" or "dolly-out" — starting close on one character and ' +
        'pulling back to reveal the other reacting — when the moment actually calls for that kind of reveal. Pick ' +
        '"none" or another movement if a static or simpler shot fits better.\n';
    } else {
      cameraRule =
        `Also choose ONE camera movement from this list (by key): ${cameraList}. The starting reference image ` +
        "only shows this one character alone, so do NOT choose a movement that implies revealing or panning to " +
        'another character who isn\'t in frame — pick "none" for a static shot unless a simple push/pan/zoom ' +
        "clearly fits.\n";
    }
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
    (skipCameraMotion ? "" : "CAMERA: <key from the camera list above>\n") +
    "PROMPT: <the finished scene prompt>"
  );
}

function parseReply(text, hasExpressionList, allowedCameraKeys, skipCameraMotion) {
  const promptMatch = text.match(/PROMPT:\s*([\s\S]+)/i);
  if (!promptMatch) {
    // The model didn't follow the format — fall back to treating the whole
    // reply as the prompt rather than failing the scene outright.
    return { prompt: text.replace(/^"|"$/g, "").trim(), matchedExpression: null, cameraMotion: "none" };
  }

  const exprMatch = text.match(/EXPRESSION:\s*([^\n]+)/i);

  // Camera wasn't even offered to the model for this scene (skipCameraMotion)
  // — nothing to parse or validate, it's simply not applicable.
  let cameraMotion = "none";
  if (!skipCameraMotion) {
    const cameraMatch = text.match(/CAMERA:\s*([^\n]+)/i);
    const rawCamera = cameraMatch ? cameraMatch[1].trim().toLowerCase().replace(/^"|"$/g, "") : "none";
    // Re-validated against the SAME restricted list the model was given for
    // this scene (not the full CAMERA_KEYS) — this is what makes the
    // restriction an actual hard constraint rather than just a shorter
    // suggestion: even if the model ignores its instructions and names a
    // disallowed key (e.g. "zoom-out" on a lip-synced scene), it gets
    // overridden to "none" here rather than passed through to /api/generate.
    cameraMotion = allowedCameraKeys.includes(rawCamera) ? rawCamera : "none";
  }

  return {
    prompt: promptMatch[1].replace(/^"|"$/g, "").trim(),
    matchedExpression: hasExpressionList && exprMatch ? exprMatch[1].trim().toLowerCase().replace(/^"|"$/g, "") : null,
    cameraMotion,
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

  // Merged-in enhance-prompt.js behavior — see ENHANCE_INSTRUCTIONS above.
  // Handled first and returns early: an enhance request has its own much
  // simpler shape (prompt + kind) and would otherwise fail the
  // characterName/lineText check just below, which only applies to the
  // original scene-prompt behavior.
  if (body.action === "enhance") {
    const { prompt, kind } = body;
    if (!prompt || !prompt.trim()) {
      res.status(400).json({ error: "Prompt is required." });
      return;
    }
    try {
      let text = await callLLM(token, ENHANCE_INSTRUCTIONS[kind] || ENHANCE_INSTRUCTIONS.image, prompt.trim(), 180);
      text = text.replace(/^"|"$/g, "").trim();
      if (!text) {
        res.status(200).json({ enhancedPrompt: prompt, note: "Model returned nothing usable; kept your original prompt." });
        return;
      }
      res.status(200).json({ enhancedPrompt: text });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Unexpected server error." });
    }
    return;
  }

  // Cross-scene continuity pre-pass — see ESTABLISH_CONTEXT_INSTRUCTION
  // above. Called once per full script, before any per-scene prompt calls.
  if (body.action === "establish-context") {
    const { lines } = body;
    if (!Array.isArray(lines) || lines.length === 0) {
      res.status(400).json({ error: "lines (a non-empty array) is required." });
      return;
    }
    try {
      const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
      let text = await callLLM(token, ESTABLISH_CONTEXT_INSTRUCTION, numbered, 220);
      text = text.replace(/^"|"$/g, "").trim();
      const establishedContext = text && text.toUpperCase() !== "NONE" ? text : "";
      res.status(200).json({ establishedContext });
    } catch (err) {
      // Same philosophy as every other auto-detection step in this app: a
      // failure here is a missed nice-to-have (scenes fall back to full
      // independence, today's behavior), not something that should block
      // generation entirely.
      res.status(200).json({ establishedContext: "", note: err.message || "Couldn't establish shared context." });
    }
    return;
  }

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
    skipCameraMotion, // true when this scene won't go through /api/generate at all (e.g. Dialogue mode's spoken lines, routed to /api/ai-avatar instead) — camera motion is inapplicable, not just restricted
    establishedContext, // optional string from the "establish-context" pre-pass — fixed visual descriptions for any object/prop that recurs across multiple scenes, so this scene doesn't invent its own competing appearance for it
  } = body;
  if (!characterName || !lineText) {
    res.status(400).json({ error: "characterName and lineText are required." });
    return;
  }

  const hasExpressionList = Array.isArray(availableExpressions) && availableExpressions.length > 0;
  const willLipSync = !nonVerbal;
  const allowedCameraKeys = willLipSync ? LIPSYNC_SAFE_CAMERA_KEYS : CAMERA_KEYS;
  const hasEstablishedContext = !!(establishedContext && establishedContext.trim());

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
  if (hasEstablishedContext) {
    userTextParts.push(
      "Established visual details from elsewhere in this same script — if this scene involves any of these " +
        "objects/items, you MUST describe it using this exact same description, not a new one of your own " +
        "invention (ignore any entry that isn't relevant to this specific scene):\n" +
        establishedContext.trim()
    );
  }
  userTextParts.push(`${nonVerbal ? "Action/stage direction" : "Line"}: "${lineText}"`);

  try {
    const instruction = buildInstruction({
      hasExpressionList,
      nonVerbal: !!nonVerbal,
      bothScene: !!bothScene,
      skipCameraMotion: !!skipCameraMotion,
    });
    const reply = await callLLM(token, instruction, userTextParts.join("\n"), 340);
    const { prompt, matchedExpression, cameraMotion } = parseReply(reply, hasExpressionList, allowedCameraKeys, !!skipCameraMotion);
    if (!prompt) throw new Error("The model returned an empty scene prompt.");
    res.status(200).json({ prompt, matchedExpression, cameraMotion });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Couldn't build a scene prompt." });
  }
};
