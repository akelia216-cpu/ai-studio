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
    const firstPathKey = Object.keys(paths)[0];
    const op = paths[firstPathKey] && paths[firstPathKey].post;
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
    const doc = await res.json();
    const { properties, required } = extractInputSchema(doc);
    const entry = { properties, required, fetchedAt: Date.now() };
    schemaCache.set(endpointId, entry);
    return entry;
  } catch {
    // If we can't introspect the schema, callers just fall back to sending
    // only the fields they're confident about (usually just "prompt").
    const fallback = { properties: {}, required: [], fetchedAt: Date.now(), unavailable: true };
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

// Submits a request to fal's queue. Unlike Replicate, this never returns the
// finished result inline — callers always poll afterwards, which is already
// how every part of this app is written.
async function createPrediction(token, endpointId, input) {
  const res = await fetch(`https://queue.fal.run/${endpointId}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, status: res.status, data };
  }
  // Encode which endpoint this request belongs to into the id, since fal's
  // status/result URLs need both the endpoint id and the request id, and a
  // later /api/status call is a separate HTTP request with no memory of
  // which endpoint created it.
  const compositeId = `${endpointId}::${data.request_id}`;
  return { ok: true, status: res.status, data: { id: compositeId, status: "starting", output: null } };
}

function splitCompositeId(id) {
  const sep = id.indexOf("::");
  if (sep === -1) return { endpointId: null, requestId: id };
  return { endpointId: id.slice(0, sep), requestId: id.slice(sep + 2) };
}

const STATUS_MAP = { COMPLETED: "succeeded", IN_PROGRESS: "processing", IN_QUEUE: "starting" };

// Extracts a usable output URL from fal's varied per-model result shapes.
function extractOutput(resultData) {
  if (!resultData) return null;
  if (resultData.images && resultData.images[0] && resultData.images[0].url) return resultData.images[0].url;
  if (resultData.image && resultData.image.url) return resultData.image.url;
  if (resultData.video && resultData.video.url) return resultData.video.url;
  if (resultData.audio && resultData.audio.url) return resultData.audio.url;
  if (resultData.audio_file && resultData.audio_file.url) return resultData.audio_file.url;
  if (resultData.output && resultData.output.url) return resultData.output.url;
  if (typeof resultData.output === "string") return resultData.output;
  return null;
}

async function getPrediction(token, compositeId) {
  const { endpointId, requestId } = splitCompositeId(compositeId);
  if (!endpointId) {
    return { ok: false, status: 400, data: { detail: "Malformed prediction id — missing endpoint." } };
  }

  const statusRes = await fetch(`https://queue.fal.run/${endpointId}/requests/${requestId}/status`, {
    headers: { Authorization: `Key ${token}` },
  });
  const statusData = await statusRes.json();
  if (!statusRes.ok) return { ok: false, status: statusRes.status, data: statusData };

  const mapped = STATUS_MAP[statusData.status] || statusData.status;
  if (mapped !== "succeeded") {
    if (mapped === "failed" || statusData.status === "FAILED") {
      return { ok: true, status: 200, data: { status: "failed", error: statusData.error || "Generation failed." } };
    }
    return { ok: true, status: 200, data: { status: mapped, output: null } };
  }

  const resultRes = await fetch(`https://queue.fal.run/${endpointId}/requests/${requestId}`, {
    headers: { Authorization: `Key ${token}` },
  });
  const resultData = await resultRes.json();
  if (!resultRes.ok) return { ok: false, status: resultRes.status, data: resultData };

  return { ok: true, status: 200, data: { status: "succeeded", output: extractOutput(resultData) } };
}

module.exports = { getInputSchema, firstSupportedField, createPrediction, getPrediction };
