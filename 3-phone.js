// 3-phone.js — was the client phoned instead?
//
// A WhatsApp left unanswered is not a client left waiting if they were rung in the same
// stretch. So before anything is called "no reply", HubSpot is checked for a connected
// call to that client between the message and the reply (or now). A call attempt that
// did not connect does not count: the client still had no answer.
const { SETTINGS } = require("./config");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hs(method, path, body, attempt = 0) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method, headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && attempt < 5) { await sleep(2000 * (attempt + 1)); return hs(method, path, body, attempt + 1); }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.json();
}

const contactCache = new Map(), callCache = new Map();
const stats = { looked: 0, matched: 0, reached: 0 };

async function contactIdFor(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  const last10 = digits.slice(-10);
  if (contactCache.has(last10)) return contactCache.get(last10);
  stats.looked++;
  let id = null;
  try {
    const r = await hs("POST", "/crm/v3/objects/contacts/search", {
      filterGroups: [
        { filters: [{ propertyName: "hs_searchable_calculated_phone_number", operator: "EQ", value: last10 }] },
        { filters: [{ propertyName: "hs_searchable_calculated_mobile_number", operator: "EQ", value: last10 }] },
      ],
      properties: ["firstname", "lastname"], limit: 3,
    });
    id = r.results?.[0]?.id || null;
    if (!id) {
      const q = await hs("POST", "/crm/v3/objects/contacts/search", { query: last10, properties: ["firstname"], limit: 3 });
      id = q.results?.[0]?.id || null;
    }
  } catch { id = null; }
  if (id) stats.matched++;
  contactCache.set(last10, id);
  return id;
}

async function callsFor(contactId) {
  if (callCache.has(contactId)) return callCache.get(contactId);
  let calls = [];
  try {
    const a = await hs("GET", `/crm/v4/objects/contacts/${contactId}/associations/calls?limit=200`);
    const ids = (a.results || []).map((x) => String(x.toObjectId));
    for (let i = 0; i < ids.length; i += 100) {
      const b = await hs("POST", "/crm/v3/objects/calls/batch/read", {
        properties: ["hs_timestamp", "hs_call_disposition", "hs_call_duration", "hubspot_owner_id"],
        inputs: ids.slice(i, i + 100).map((id) => ({ id })),
      });
      calls.push(...(b.results || []).map((c) => ({
        at: Date.parse(c.properties.hs_timestamp) || 0,
        connected: c.properties.hs_call_disposition === SETTINGS.CONNECTED_DISPOSITION ||
                   Number(c.properties.hs_call_duration || 0) >= SETTINGS.CONNECTED_MIN_SECONDS * 1000,
      })));
    }
  } catch { calls = []; }
  callCache.set(contactId, calls);
  return calls;
}

// { checked, matched, reachedAt }
async function reachedByPhone(phone, fromMs, toMs) {
  if (!SETTINGS.USE_PHONE_CHECK || !process.env.HUBSPOT_TOKEN) return { checked: false };
  const id = await contactIdFor(phone);
  if (!id) return { checked: true, matched: false };
  const hit = (await callsFor(id)).find((c) => c.connected && c.at >= fromMs && c.at <= toMs);
  if (hit) stats.reached++;
  return { checked: true, matched: true, reachedAt: hit ? hit.at : null };
}

module.exports = { reachedByPhone, stats };
