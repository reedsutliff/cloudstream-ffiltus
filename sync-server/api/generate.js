// POST /api/generate
// Generates a new tracking phrase and returns it
const { generate } = require("../lib/wordlist.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const phrase = generate(5, "-");
  return res.status(200).json({ phrase });
};
