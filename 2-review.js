// 2-review.js — the second opinion, for waits that already look like problems.
//
// The clock decides whether something was late. This only answers what a clock cannot:
// did the client's message genuinely need anything back, and what were they asking for.
// It is told to be strict — when in doubt, it needed a reply — because a reviewer who
// waves things through is worse than none.
//
// Only the messages in that one wait are sent: no name, no phone number.
const { SETTINGS } = require("./config");
const { snippet, fmtWhen } = require("./1-rules");
const { toMs } = require("./0-chatwoot");

let MODEL = null;
async function pickModel() {
  if (MODEL) return MODEL;
  const key = process.env.GEMINI_KEY;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`);
    const d = await res.json();
    const list = (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name).replace(/^models\//, ""))
      .filter((n) => !/image|tts|live|embed|aqa|native-audio|dialog|computer-use|robotics/i.test(n));
    for (const want of SETTINGS.AI_MODELS) {
      MODEL = list.find((n) => n === want) || list.find((n) => n.startsWith(want));
      if (MODEL) break;
    }
    MODEL = MODEL || list.find((n) => /flash/i.test(n)) || SETTINGS.AI_MODELS[0];
  } catch { MODEL = SETTINGS.AI_MODELS[0]; }
  return MODEL;
}

async function review(wait, a) {
  if (!SETTINGS.USE_AI_REVIEW || !process.env.GEMINI_KEY) return null;
  const lines = wait.client.slice(0, 8).map((m) => `- [${fmtWhen(toMs(m.created_at))}] ${snippet(m, 300)}`).join("\n");
  const reply = wait.reply ? `[${fmtWhen(toMs(wait.reply.created_at))}] ${snippet(wait.reply, 200)}` : "No reply.";

  const prompt =
`You are a compliance reviewer at an immigration consultancy, checking whether a case manager answered clients on WhatsApp in time.

Below is one moment where a client wrote and waited. Judge it as a strict but fair manager would.

1. needsReply: did the client's message(s) need a reply from the case manager?
   They did NOT if they were only thanks, an acknowledgement, an emoji, a "ok noted", or simply closed the conversation.
   They DID if there was a question, a request, a document sent for review, a complaint, a worry, or anything needing action.
   When in doubt, they needed a reply.
2. asked: in under 12 words, what the client needed. Write it so it follows "asking" — e.g. "whether the ECA had been submitted".

Client wrote (oldest first):
${lines}

What came back: ${reply}

Reply ONLY JSON: {"needsReply": true|false, "asked": "..."}`;

  try {
    const model = await pickModel();
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }),
    });
    const d = await res.json();
    if (d.error) return { error: d.error.message };
    const t = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return { error: "unreadable" };
    const j = JSON.parse(m[0]);
    return { needsReply: j.needsReply !== false, asked: String(j.asked || "").slice(0, 120) };
  } catch (e) { return { error: e.message }; }
}

module.exports = { review, pickModel };
