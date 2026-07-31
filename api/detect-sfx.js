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

// NOTE: this runs on a small, cheap model (Llama 3.2 3B — see _llm.js), which
// is prone to pattern-matching onto the *example* sound effects listed below
// rather than actually checking whether the input text names one. Confirmed
// real-world failure: the line "I found something over here!" — a plain
// exclamation naming no object or sound-making event at all — got matched to
// "Glass shattering", almost certainly because "glass breaking" is one of
// the illustrative examples in this instruction. Two things below exist
// specifically to counter that: (1) an explicit "named in the text, not
// merely evoked/associated" rule, and (2) few-shot examples including that
// exact near-miss, since small models follow concrete examples far more
// reliably than abstract rules alone.
const INSTRUCTION =
  "You read one short line of dialogue, narration, or a video scene description. Decide whether it depicts " +
  "a distinct physical action that would make a noticeable, specific sound effect — for example throwing or " +
  "hitting an object, a door slamming, footsteps, a splash, glass breaking, thunder, an engine starting. " +
  "Those are illustrations of the KIND of thing that counts, not a checklist — do not match a line to one of " +
  "them just because it feels thematically similar or mysterious. " +
  "The action AND the object/surface involved must both be explicitly named or unambiguously and specifically " +
  "described in the text itself. A vague statement that something happened, was found, or was noticed — with " +
  "no stated object, impact, or motion — does NOT count, even if a sound effect seems plausible or dramatic. " +
  "When genuinely unsure, answer NONE rather than guessing. " +
  "Ordinary talking, walking calmly, discovering/noticing something with no described physical event, and quiet " +
  "emotional moments do NOT count. " +
  'If there IS a clear sound-effect-worthy action, reply with ONLY a short 3-8 word sound description suitable ' +
  'for generating that exact sound effect (e.g. "a rock hitting a wooden fence"). ' +
  "If there is no such action, reply with exactly the single word: NONE. " +
  "Never invent an action, object, or sound that isn't stated or clearly, specifically implied by the text. " +
  "Reply with nothing else — no quotes, no explanation.\n\n" +
  "Examples:\n" +
  'Text: "I found something over here!"\n' +
  "Reply: NONE\n" +
  '(No object, impact, or motion is named — just an exclamation about a discovery. Do not guess "glass breaking" ' +
  "or anything else here.)\n\n" +
  'Text: "He slammed the door and stormed off."\n' +
  "Reply: a door slamming shut hard\n\n" +
  'Text: "What did you find, Pip?"\n' +
  "Reply: NONE\n" +
  "(Ordinary spoken dialogue, no physical action at all.)\n\n" +
  'Text: "The rock hit the fence with a loud crack."\n' +
  "Reply: a rock hitting a wooden fence\n\n" +
  'Text: "They both lean in to look closer."\n' +
  "Reply: NONE\n" +
  "(A quiet physical movement, but nothing that makes a distinct, noticeable sound.)";

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
    // Wrap the real input in the exact same `Text: "..."\nReply:` shape as
    // the few-shot examples in INSTRUCTION. Verified live (see the
    // real-model tests that motivated this): sending the bare line as the
    // prompt, while the system prompt's examples use that Text:/Reply:
    // pattern, sometimes left this small model unsure whether it was being
    // asked to classify or being addressed conversationally — on the input
    // "Hmm... I'm not sure yet." it drifted into chatty replies ("Go ahead
    // and share the line...") instead of classifying, in 3 of 4 live runs.
    // Matching the exact format removes that ambiguity.
    const wrappedInput = `Text: "${text.trim()}"\nReply:`;
    let reply = await callLLM(token, INSTRUCTION, wrappedInput, 40);
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
