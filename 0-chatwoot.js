// 0-chatwoot.js — talking to Chatwoot.
// Gentle on rate limits, and every failure says what to check rather than just a code.
const { SETTINGS } = require("./config");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

async function cw(method, path, body, attempt = 0) {
  const gap = 1000 / SETTINGS.CHATWOOT_RPS;
  const wait = lastCall + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const url = SETTINGS.CHATWOOT_URL.replace(/\/+$/, "") + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { api_access_token: process.env.CHATWOOT_TOKEN || "", "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (attempt < 4) { await sleep(2000 * (attempt + 1)); return cw(method, path, body, attempt + 1); }
    throw new Error(`Could not reach Chatwoot at ${SETTINGS.CHATWOOT_URL}: ${e.message}`);
  }

  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const ra = Number(res.headers.get("retry-after")) || 0;
    await sleep(Math.max(ra * 1000, 3000 * (attempt + 1)));
    return cw(method, path, body, attempt + 1);
  }

  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 ? " — the token was rejected. Check the CHATWOOT_TOKEN secret." :
      res.status === 403 ? " — this token cannot see that. It needs to belong to an administrator." :
      res.status === 404 ? " — not found. If HOF's Chatwoot is not app.chatwoot.com, set CHATWOOT_URL." : "";
    throw new Error(`${method} ${path} -> ${res.status}${hint} ${text.slice(0, 160)}`);
  }
  if (text.trim().startsWith("<")) throw new Error(`${path} returned a web page, not data — CHATWOOT_URL is probably wrong.`);
  return text ? JSON.parse(text) : null;
}

// created_at arrives as unix seconds; accept milliseconds or a date string too
function toMs(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (/^\d+$/.test(String(v))) { const n = Number(v); return n > 1e12 ? n : n * 1000; }
  return Date.parse(v) || 0;
}

const profile = () => cw("GET", "/api/v1/profile");
const agents = (acc) => cw("GET", `/api/v1/accounts/${acc}/agents`);
const inboxes = (acc) => cw("GET", `/api/v1/accounts/${acc}/inboxes`);
const teams = (acc) => cw("GET", `/api/v1/accounts/${acc}/teams`).catch(() => []);

// Every conversation assigned to one agent. Pages until an empty page, and stops if the
// server hands back pages it has already sent, so a quirk cannot loop forever.
async function conversationsFor(acc, agentId, asString = false) {
  const all = new Map();
  for (let page = 1; page <= 400; page++) {
    const r = await cw("POST", `/api/v1/accounts/${acc}/conversations/filter?page=${page}`, {
      payload: [{ attribute_key: "assignee_id", filter_operator: "equal_to",
                  values: [asString ? String(agentId) : Number(agentId)], query_operator: null }],
    });
    const list = (r && r.data && r.data.payload) || (r && r.payload) || [];
    if (!list.length) break;
    const before = all.size;
    for (const c of list) all.set(c.id, c);
    if (all.size === before) break;
  }
  return [...all.values()];
}

// The messages of one conversation back to a given time: the newest page first, then
// older pages until the start of the period (plus the buffer) is passed.
async function messagesSince(acc, convId, sinceMs) {
  const seen = new Map();
  let r = await cw("GET", `/api/v1/accounts/${acc}/conversations/${convId}/messages`);
  let batch = (r && r.payload) || [];
  batch.forEach((m) => seen.set(m.id, m));
  for (let i = 0; i < 500 && batch.length; i++) {
    const oldest = batch.reduce((a, m) => (!a || m.id < a.id ? m : a), null);
    if (!oldest || toMs(oldest.created_at) < sinceMs) break;
    r = await cw("GET", `/api/v1/accounts/${acc}/conversations/${convId}/messages?before=${oldest.id}`);
    batch = ((r && r.payload) || []).filter((m) => !seen.has(m.id));
    batch.forEach((m) => seen.set(m.id, m));
  }
  return [...seen.values()].sort((a, b) => toMs(a.created_at) - toMs(b.created_at) || a.id - b.id);
}

const conversationLink = (acc, id) => `${SETTINGS.CHATWOOT_URL.replace(/\/+$/, "")}/app/accounts/${acc}/conversations/${id}`;

module.exports = { cw, toMs, profile, agents, inboxes, teams, conversationsFor, messagesSince, conversationLink };
