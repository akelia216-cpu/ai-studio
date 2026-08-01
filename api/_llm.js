const { getInputSchema, firstSupportedField, createPrediction, getPrediction } = require("./_fal");

// fal.ai's shared text-generation endpoint — unlike Replicate, the specific
// underlying model isn't baked into the endpoint path; it must be passed as
// an explicit `model` field in the request input.
const LLM_MODEL = "fal-ai/any-llm";

// Bumped 2026-08 from "meta-llama/llama-3.2-3b-instruct". That 3B model is
// exactly what forced this session's whole run of SFX-detection and
// scene-prompt-continuity fixes (api/detect-sfx.js, api/build-scene-prompt.js)
// to exist in the first place — it kept pattern-matching onto instruction
// examples and hallucinating actions/objects that weren't in the input text,
// which is a small-model failure mode, not something more prompt tuning
// alone was ever going to fully close out.
//
// Confirmed live via fal-ai/any-llm's own openapi schema: "google/gemini-2.5-
// flash-lite" is fal's OWN current default model for this exact endpoint
// (schema field: model.default), and it's in the same standard pricing tier
// as llama-3.2-3b-instruct was — NOT one of the endpoint's listed "premium"
// models (those are charged at 10x and include gpt-4.1, claude-3.5-sonnet,
// gemini-2.5-pro, etc. — gemini-2.5-flash-lite is not among them). This is
// meaningfully more capable while costing the same per call.
//
// NOT yet live-tested against real requests — the fal.ai key on this
// project had zero balance at the time this was changed (a partial live
// comparison against the exact false-positive cases from this session's SFX
// fixes was in progress when the balance ran out). Re-run those same cases
// once the key has balance again to confirm this actually reduces
// hallucination rate as expected, rather than just assuming it from the
// model's general reputation.
const LLM_UNDERLYING_MODEL = "google/gemini-2.5-flash-lite";

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 45000; // LLM calls here are short (prompt rewrites, scene lists)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Calls the shared text model with a system instruction + user text, and
// returns the plain text response. fal's queue API is always async (unlike
// Replicate, which could return a finished result inline for fast models),
// so this submits the job and polls until it completes or times out.
async function callLLM(token, systemInstruction, userText, maxTokens = 200) {
  const schema = await getInputSchema(token, LLM_MODEL);
  const systemField = firstSupportedField(schema, ["system_prompt", "system"]);
  const promptField = firstSupportedField(schema, ["prompt"]) || "prompt";
  const maxTokensField = firstSupportedField(schema, ["max_new_tokens", "max_tokens"]);
  const modelField = firstSupportedField(schema, ["model"]) || "model";

  const input = { [modelField]: LLM_UNDERLYING_MODEL };
  if (systemField) {
    input[systemField] = systemInstruction;
    input[promptField] = userText;
  } else {
    input[promptField] = `${systemInstruction}\n\n${userText}`;
  }
  if (maxTokensField) input[maxTokensField] = maxTokens;

  const { ok, status, data } = await createPrediction(token, LLM_MODEL, input);
  if (!ok) {
    const err = new Error(data?.detail || data?.message || "LLM request was rejected.");
    err.status = status;
    throw err;
  }

  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await getPrediction(token, data.id);
    if (!poll.ok) {
      const err = new Error(poll.data?.detail || "LLM status check failed.");
      err.status = poll.status;
      throw err;
    }
    if (poll.data.status === "failed") {
      const err = new Error(poll.data.error || "LLM generation failed.");
      err.status = 502;
      throw err;
    }
    if (poll.data.status === "succeeded") {
      let text = poll.data.output;
      if (Array.isArray(text)) text = text.join("");
      return (text || "").trim();
    }
  }

  const timeoutErr = new Error("LLM request timed out waiting for a response.");
  timeoutErr.status = 504;
  throw timeoutErr;
}

module.exports = { callLLM, LLM_MODEL };
