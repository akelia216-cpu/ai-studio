const { getInputSchema, firstSupportedField, createPrediction, getPrediction } = require("./_fal");

// fal.ai's shared text-generation endpoint — unlike Replicate, the specific
// underlying model isn't baked into the endpoint path; it must be passed as
// an explicit `model` field in the request input.
const LLM_MODEL = "fal-ai/any-llm";
const LLM_UNDERLYING_MODEL = "meta-llama/llama-3.2-3b-instruct";

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
