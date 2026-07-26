const { getPrediction } = require("./_fal");

module.exports = async function handler(req, res) {
  const token = process.env.FAL_KEY;
  if (!token) {
    res.status(500).json({ error: "Server is missing FAL_KEY." });
    return;
  }

  const { id } = req.query;
  if (!id) {
    res.status(400).json({ error: "Missing prediction id." });
    return;
  }

  try {
    const { ok, status, data } = await getPrediction(token, id);

    if (!ok) {
      res.status(status).json({
        error: data?.detail || "Failed to fetch prediction status.",
      });
      return;
    }

    res.status(200).json({
      id,
      status: data.status, // starting | processing | succeeded | failed | canceled
      output: data.output || null,
      error: data.error || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
