// 1-rules.js — the judgement, as plain code with no network in it, so every rule can be
// tested against invented conversations before it is ever used on a real person.
const { SETTINGS, ACK_WORDS } = require("./config");
const { toMs } = require("./0-chatwoot");

const HOUR = 3600e3, DAY = 24 * HOUR;
const OFF = SETTINGS.TZ_OFFSET_HOURS * HOUR;
const dayStart = (t) => Math.floor((t + OFF) / DAY) * DAY - OFF;
const dateKey = (t) => new Date(t + OFF).toISOString().slice(0, 10);
const weekday = (t) => new Date(t + OFF).getUTCDay();

// ---- the clock: 24 hours, paused on weekends, holidays and leave ----
function makeClock(leaveDates = [], holidays = SETTINGS.HOLIDAYS) {
  const off = new Set([...(holidays || []), ...(leaveDates || [])]);
  const isWorkingDay = (t) => !SETTINGS.WEEKEND_DAYS.includes(weekday(t)) && !off.has(dateKey(t));
  const nextWorkingDayFrom = (d) => { let x = d; for (let i = 0; i < 60 && !isWorkingDay(x); i++) x += DAY; return x; };

  function deadline(t) {
    let cursor = isWorkingDay(t) ? t : nextWorkingDayFrom(dayStart(t) + DAY);
    let remaining = SETTINGS.ALLOWED_HOURS * HOUR;
    for (let i = 0; i < 60; i++) {
      const end = dayStart(cursor) + DAY;
      if (end - cursor >= remaining) return cursor + remaining;
      remaining -= end - cursor;
      cursor = nextWorkingDayFrom(end);
    }
    return cursor;
  }

  function workingBetween(a, b) {
    if (!(b > a)) return 0;
    let total = 0;
    for (let d = dayStart(a), i = 0; d < b && i < 800; d += DAY, i++) {
      if (!isWorkingDay(d)) continue;
      const s = Math.max(a, d), e = Math.min(b, d + DAY);
      if (e > s) total += e - s;
    }
    return total;
  }

  // did the wait run across a day the clock did not count?
  function spannedDayOff(a, b) {
    for (let d = dayStart(a), i = 0; d < b && i < 60; d += DAY, i++) if (!isWorkingDay(d)) return true;
    return false;
  }

  return { deadline, workingBetween, isWorkingDay, spannedDayOff };
}

// ---- who sent a message ----
function normType(v) {
  const s = String(v);
  if (s === "0" || s === "incoming") return "incoming";
  if (s === "1" || s === "outgoing") return "outgoing";
  if (s === "2" || s === "activity") return "activity";
  if (s === "3" || s === "template") return "template";
  return s;
}

// client | staff | bot | auto | ignore
function whoSent(m) {
  if (m.private) return "ignore";                       // an internal note, never a reply to the client
  const type = normType(m.message_type);
  const st = String(m.sender_type || (m.sender && m.sender.type) || "");
  if (type === "incoming") return "client";
  if (type === "activity") return "ignore";             // "assigned to…", "resolved", and the like
  if (/agentbot|captain/i.test(st)) return "bot";        // an automatic reply is not an answer
  if (type === "outgoing") return "staff";               // a person — through Chatwoot, or from the phone
  if (type === "template") return /user/i.test(st) ? "staff" : "auto";  // a person's template counts; a campaign does not
  return "ignore";
}

// ---- does a message need anything back? ----
const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200d\uFE0F]/gu;
function isAck(m) {
  if (String(m.content_type || "") === "sticker") return true;
  const hasFile = (Array.isArray(m.attachments) && m.attachments.length > 0) || !!m.attachment;
  const raw = String(m.content || "").trim();
  if (!raw) return !hasFile;                             // a document or photo needs attention
  if (hasFile) return false;
  if (/[?؟]/.test(raw)) return false;                    // a question always needs an answer
  const text = raw.toLowerCase().replace(EMOJI, " ").replace(/[.,!،؛:;\-~*_()"']+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return true;                                // emojis only
  if (text.length > 40) return false;
  return text.split(" ").every((w) => ACK_WORDS.has(w));
}

// ---- conversations into waits ----
// A wait opens with the first client message after the team last spoke, runs through any
// further client messages, and closes at the next reply from a person. Four messages in a
// row are one wait, timed from the first.
function buildWaits(messages) {
  const waits = [];
  let open = null;
  for (const m of messages) {
    const who = whoSent(m);
    if (who === "client") { if (!open) open = { client: [m], reply: null }; else open.client.push(m); }
    else if (who === "staff" && open) { open.reply = m; waits.push(open); open = null; }
  }
  if (open) waits.push(open);
  return waits;
}

function assess(wait, clock, nowMs) {
  const start = toMs(wait.client[0].created_at);
  const due = clock.deadline(start);
  const replyAt = wait.reply ? toMs(wait.reply.created_at) : null;
  const needs = wait.client.some((m) => !isAck(m));
  const chaseMs = SETTINGS.CHASE_AFTER_HOURS * HOUR;
  const followUps = wait.client.slice(1).filter((m) => {
    const t = toMs(m.created_at);
    return (replyAt === null || t < replyAt) && clock.workingBetween(start, t) >= chaseMs;
  }).length;

  let verdict;
  if (!needs) verdict = "no-reply-needed";
  else if (replyAt !== null) verdict = replyAt <= due ? "on-time" : "late";
  else verdict = nowMs > due ? "no-reply" : "pending";

  const end = replyAt !== null ? replyAt : nowMs;
  return {
    start, due, replyAt, needs, followUps, verdict,
    waitCalMs: end - start,
    waitWorkMs: clock.workingBetween(start, end),
    overByMs: (verdict === "late" || verdict === "no-reply") ? clock.workingBetween(due, end) : 0,
    dayOff: clock.spannedDayOff(start, end),
  };
}

// ---- wording ----
const fmtWhen = (t) => {
  const d = new Date(t + OFF);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${day} ${d.getUTCDate()} ${mon}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const hrs = (ms) => Math.round(ms / HOUR);
const calText = (ms) => {
  const h = Math.round(ms / HOUR);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24), r = h % 24;
  return `${d} day${d === 1 ? "" : "s"}${r ? ` ${r} hour${r === 1 ? "" : "s"}` : ""}`;
};
const snippet = (m, n = 90) => {
  const t = String((m && m.content) || "").replace(/\s+/g, " ").trim();
  if (!t) return (m && ((m.attachments && m.attachments.length) || m.attachment)) ? "[sent a file]" : "[no text]";
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

// The one-line reason a person could stand behind: the times, the allowance, the breach.
function comment(a, wait, asked) {
  const what = asked ? ` asking ${asked.replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/\.$/, "")}` : "";
  const chased = a.followUps ? ` The client had to follow up ${a.followUps} time${a.followUps > 1 ? "s" : ""}.` : "";
  const weekend = a.dayOff ? " Weekend and days off were not counted." : "";
  if (a.verdict === "late")
    return `Client wrote ${fmtWhen(a.start)}${what}. First reply ${fmtWhen(a.replyAt)} — ${hrs(a.waitWorkMs)} working hours against ${SETTINGS.ALLOWED_HOURS} allowed.${chased}${weekend}`;
  if (a.verdict === "no-reply")
    return `Client wrote ${fmtWhen(a.start)}${what}. No reply by the deadline of ${fmtWhen(a.due)}, and none since.${chased}${weekend}`;
  return "";
}

module.exports = { makeClock, whoSent, isAck, buildWaits, assess, comment, fmtWhen, calText, hrs, snippet, dateKey, HOUR, DAY };
