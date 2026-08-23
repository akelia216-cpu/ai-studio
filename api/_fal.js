// Shared helpers for talking to fal.ai: fetching a model's live input
// schema, and creating/checking queue-based predictions.
//
// fal.ai's public per-model schema endpoint (used by their own docs pages)
// returns a standard OpenAPI document, but — unlike Replicate, which always
// names the request schema "Input" — fal doesn't use a fixed schema name.
// We resolve the request body schema generically by following the $ref on
// the (single) POST path instead of assuming a name.

const schemaCache = new Map(); // endpointId -> { properties, required, fetchedAt }
const SCHEMA_TTL_MS = 10 * 60 * 1000;

function resolveRef(doc, ref) {
  const path = ref.replace(/^#\//, "").split("/");
  let node = doc;
  for (const p of path) node = node && node[p];
  return node;
}

function extractInputSchema(doc) {
  try {
    const paths = doc.paths || {};
    // fal's openapi doc lists several paths for one endpoint (the queue
    // status/cancel/result routes plus the actual submission route) in no
    // guaranteed order, and only the submission route has a POST — so the
    // *first* path key is not reliably the right one (it's often
    // "/{...}/requests/{request_id}/status", which only has a GET). Find
    // the path that actually declares a POST instead of assuming position 0.
    let op;
    for (const key of Object.keys(paths)) {
      if (paths[key] && paths[key].post) {
        op = paths[key].post;
        break;
      }
    }
    let schema = op && op.requestBody && op.requestBody.content && op.requestBody.content["application/json"] && op.requestBody.content["application/json"].schema;
    if (schema && schema.$ref) schema = resolveRef(doc, schema.$ref);
    if (schema && schema.properties) return { properties: schema.properties, required: schema.required || [] };
  } catch {
    // fall through
  }
  return { properties: {}, required: [] };
}

async function getInputSchema(token, endpointId) {
  const cached = schemaCache.get(endpointId);
  if (cached && Date.now() - cached.fetchedAt < SCHEMA_TTL_MS) return cached;

  try {
    const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpointId)}`;
    const res = await fetch(url, { headers: { Authorization: `Key ${token}` } });
    if (!res.ok) throw new Error(`schema fetch ${res.status}`);
    const doc = await safeReadJson(res);
    if (doc.__empty || doc.__unparsed) throw new Error("schema response was not valid JSON");
    const { properties, required } = extractInputSchema(doc);
    // The raw doc is kept alongside the extracted top-level fields (not just
    // properties/required) so callers can resolve a NESTED object property's
    // own sub-schema afterward — e.g. Minimax's speech-02-hd doesn't expose
    // "voice_id" at the top level at all; it lives at
    // "voice_setting.voice_id". Without the raw doc there'd be no way to
    // follow that property's $ref after the fact. See resolveNestedProperty.
    const entry = { properties, required, fetchedAt: Date.now(), doc };
    schemaCache.set(endpointId, entry);
    return entry;
  } catch {
    // If we can't introspect the schema, callers just fall back to sending
    // only the fields they're confident about (usually just "prompt").
    const fallback = { properties: {}, required: [], fetchedAt: Date.now(), unavailable: true, doc: null };
    schemaCache.set(endpointId, fallback);
    return fallback;
  }
}

function firstSupportedField(schema, candidates) {
  for (const name of candidates) {
    if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, name)) {
      return name;
    }
  }
  return null;
}

// Resolves a top-level property's own sub-schema (following its $ref, if
// any) using the raw doc a getInputSchema() result carries alongside its
// flattened properties/required. Returns null if the property doesn't
// exist, isn't an object schema, or the raw doc isn't available (e.g. the
// schema fetch itself failed and getInputSchema returned its empty
// fallback). Needed for any model — like Minimax's speech-02-hd — whose
// real field of interest is nested inside an object property rather than
// declared flat at the top level.
function resolveNestedProperty(schemaEntry, propName) {
  if (!schemaEntry || !schemaEntry.doc || !schemaEntry.properties) return null;
  let propSchema = schemaEntry.properties[propName];
  if (!propSchema) return null;
  if (propSchema.$ref) propSchema = resolveRef(schemaEntry.doc, propSchema.$ref);
  if (!propSchema || !propSchema.properties) return null;
  return { properties: propSchema.properties, required: propSchema.required || [] };
}

// Reads a response body defensively — fal occasionally returns an empty or
// non-JSON body (e.g. on a 404 for a mistaken URL, or a gateway hiccup), and
// calling .json() directly on that throws "Unexpected end of JSON input",
// which is confusing to surface to a user as-is. This always returns a
// plain object with a readable message instead of throwing.
async function safeReadJson(res) {
  const text = await res.text();
  if (!text) return { __empty: true };
  try {
    return JSON.parse(text);
  } catch {
    return { __unparsed: true, __raw: text.slice(0, 300) };
  }
}

// fal's queue system tracks a request under the *app*, which for most
// models is just the first two path segments (e.g. "fal-ai/flux"), not the
// full endpoint id used for submission (e.g. "fal-ai/flux/schnell" or
// "fal-ai/kling-video/v1.6/standard/text-to-video"). Some models submit and
// poll under the exact same path; others only accept the trimmed base for
// status/result. Since this can't be confirmed per-model in advance, try
// the full endpoint id first and fall back to the trimmed base on a 404.
function baseAppId(endpointId) {
  const parts = endpointId.split("/");
  if (parts.length <= 2) return null;
  return parts.slice(0, 2).join("/");
}

// Submits a request to fal's queue. Unlike Replicate, this never returns the
// finished result inline — callers always poll afterwards, which is already
// how every part of this app is written.
//
// fal's submit response includes the exact status_url/response_url to poll
// (this is the authoritative source — trust it over guessing a URL shape
// from the endpoint id, since fal's queue URL structure isn't identical
// across every model family). Those get encoded into the id we hand back to
// the client so a later, separate /api/status request can use them too.
async function createPrediction(token, endpointId, input) {
  const res = await fetch(`https://queue.fal.run/${endpointId}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = await safeReadJson(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: { detail: stringifyError(data.detail) || stringifyError(data.message) || describeUnparsed(data) || `Request was rejected (${res.status}).` },
    };
  }
  if (!data.request_id) {
    return { ok: false, status: 502, data: { detail: describeUnparsed(data) || "fal.ai didn't return a request id." } };
  }
  const compositeId = encodeCompositeId({
    endpointId,
    requestId: data.request_id,
    statusUrl: data.status_url || null,
    responseUrl: data.response_url || null,
  });
  return { ok: true, status: res.status, data: { id: compositeId, status: "starting", output: null } };
}

// The composite id is base64url-encoded JSON so it survives being passed
// around as a plain query-string value (e.g. /api/status?id=...) without
// needing extra escaping, and so it can carry more than just two fields.
function encodeCompositeId(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function splitCompositeId(id) {
  try {
    const decoded = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
    if (decoded && decoded.endpointId && decoded.requestId) return decoded;
  } catch {
    // fall through to the legacy "endpointId::requestId" format below, in
    // case an older id (from before this encoding) is still being polled.
  }
  const sep = id.indexOf("::");
  if (sep === -1) return { endpointId: null, requestId: id };
  return { endpointId: id.slice(0, sep), requestId: id.slice(sep + 2), statusUrl: null, responseUrl: null };
}

const STATUS_MAP = { COMPLETED: "succeeded", IN_PROGRESS: "processing", IN_QUEUE: "starting" };

// Extracts a usable output URL from fal's varied per-model result shapes.
function extractOutput(resultData) {
  if (!resultData) return null;
  // Voice cloning doesn't return a media file at all — it returns an opaque
  // voice id string to reuse in later TTS calls. Piping it through the same
  // "output" field the rest of the app already polls for lets /api/voice-clone
  // reuse the existing generic status/poll plumbing instead of a bespoke path.
  if (resultData.custom_voice_id) return resultData.custom_voice_id;
  if (resultData.images && resultData.images[0] && resultData.images[0].url) return resultData.images[0].url;
  if (resultData.image && resultData.image.url) return resultData.image.url;
  if (resultData.video && resultData.video.url) return resultData.video.url;
  if (resultData.audio && resultData.audio.url) return resultData.audio.url;
  if (resultData.audio_file && resultData.audio_file.url) return resultData.audio_file.url;
  if (resultData.output && resultData.output.url) return resultData.output.url;
  if (typeof resultData.output === "string") return resultData.output;
  // Whisper (api/transcribe.js) doesn't return a media
  // file at all — its result is a JSON object ({ text, chunks: [...] }, plus
  // speaker labels when diarize is on). There's no single URL to hand back,
  // so the whole result is JSON-stringified and piped through the same
  // generic "output" field every other prediction uses — the frontend
  // JSON.parses it back out instead of treating it as a playable URL.
  if (typeof resultData.text === "string") return JSON.stringify(resultData);
  return null;
}

// GETs a queue URL, trying (in order): the exact URL fal gave us at submit
// time (most reliable — this is what fal's own docs/SDKs treat as
// authoritative), then the constructed full-endpoint-id URL, then the
// trimmed base-app-id URL. Stops at the first response that isn't a 404.
async function queueGet(token, { authoritativeUrl, endpointId, requestId, suffix }) {
  const attempt = async (url) => {
    const res = await fetch(url, { headers: { Authorization: `Key ${token}` } });
    const data = await safeReadJson(res);
    return { res, data };
  };

  const candidates = [];
  if (authoritativeUrl) candidates.push(authoritativeUrl);
  candidates.push(`https://queue.fal.run/${endpointId}/requests/${requestId}${suffix}`);
  const base = baseAppId(endpointId);
  if (base && base !== endpointId) candidates.push(`https://queue.fal.run/${base}/requests/${requestId}${suffix}`);

  let last = null;
  for (const url of candidates) {
    last = await attempt(url);
    if (last.res.status !== 404) return last;
  }
  return last;
}

async function getPrediction(token, compositeId) {
  const { endpointId, requestId, statusUrl, responseUrl } = splitCompositeId(compositeId);
  if (!endpointId || !requestId) {
    return { ok: false, status: 400, data: { detail: "Malformed prediction id — missing endpoint or request id." } };
  }

  const { res: statusRes, data: statusData } = await queueGet(token, {
    authoritativeUrl: statusUrl,
    endpointId,
    requestId,
    suffix: "/status",
  });
  if (!statusRes.ok) {
    return {
      ok: false,
      status: statusRes.status,
      data: { detail: stringifyError(statusData.detail) || stringifyError(statusData.message) || describeUnparsed(statusData) || `Status check failed (${statusRes.status}).` },
    };
  }

  const mapped = STATUS_MAP[statusData.status] || statusData.status;
  if (mapped !== "succeeded") {
    if (mapped === "failed" || statusData.status === "FAILED") {
      return { ok: true, status: 200, data: { status: "failed", error: stringifyError(statusData.error) || "Generation failed." } };
    }
    return { ok: true, status: 200, data: { status: mapped || "processing", output: null } };
  }

  const { res: resultRes, data: resultData } = await queueGet(token, {
    authoritativeUrl: responseUrl,
    endpointId,
    requestId,
    suffix: "/response",
  });
  if (!resultRes.ok) {
    return {
      ok: false,
      status: resultRes.status,
      data: { detail: stringifyError(resultData.detail) || stringifyError(resultData.message) || describeUnparsed(resultData) || `Result fetch failed (${resultRes.status}).` },
    };
  }

  // Some fal models (the flux/BFL family especially) report a moderation
  // block by returning a perfectly normal "COMPLETED" status whose image is
  // a blank placeholder — in practice a solid black PNG — with the only real
  // signal being a has_nsfw_concepts flag alongside it. Handing that URL back
  // as a success is what made a blocked generation look like a broken app.
  // Treat the flag as the failure it actually is, so the UI shows a real
  // reason instead of a black square.
  if (Array.isArray(resultData?.has_nsfw_concepts) && resultData.has_nsfw_concepts.some(Boolean)) {
    return {
      ok: true,
      status: 200,
      data: {
        status: "failed",
        error:
          "The model's content filter blocked this one and returned a blank image instead. This is the provider's own filter, not a setting in this app — it fires most often on photorealistic prompts describing a real person's body, clothing or pose. Try a different model, or soften the wording of the prompt.",
      },
    };
  }

  return { ok: true, status: 200, data: { status: "succeeded", output: extractOutput(resultData) } };
}

function describeUnparsed(data) {
  if (data.__empty) return "The provider returned an empty response.";
  if (data.__unparsed) return `The provider returned an unexpected response: ${data.__raw}`;
  return null;
}

// fal doesn't always send error details as a plain string — sometimes it's
// an object (e.g. { message, type, ... } or a validation-error array).
// Whatever shape it is, this always returns something readable rather than
// letting "[object Object]" leak through to the UI.
function stringifyError(err) {
  if (!err) return null;
  if (typeof err === "string") return err;
  if (Array.isArray(err)) return err.map(stringifyError).filter(Boolean).join("; ");
  if (typeof err === "object") {
    // FastAPI/Pydantic-style validation errors (which is what fal's queue
    // API returns) look like { loc: ["body", "image_url"], msg: "Field
    // required", type: "missing" } — surface *which* field, not just "Field
    // required" with no way to tell what's missing.
    if (Array.isArray(err.loc) && typeof err.msg === "string") {
      const field = err.loc.filter((p) => p !== "body").join(".");
      return field ? `${field}: ${err.msg}` : err.msg;
    }
    if (typeof err.message === "string") return err.message;
    if (typeof err.detail === "string") return err.detail;
    if (typeof err.msg === "string") return err.msg;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

module.exports = { getInputSchema, firstSupportedField, resolveNestedProperty, createPrediction, getPrediction };
