// selftest.js — every rule, against invented conversations where the answer is known.
// It runs before each audit. Because this feeds a real person's evaluation, a rule that
// stops behaving stops the run.
const R = require("./1-rules");
const { SETTINGS } = require("./config");

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n        ${detail}`}`);
  ok ? pass++ : fail++;
};
const PKT = (s) => Date.parse(s + "+05:00");
const sec = (s) => Math.floor(PKT(s) / 1000);
let id = 1;
const client = (at, content, extra = {}) => ({ id: id++, message_type: 0, sender_type: "Contact", private: false, created_at: sec(at), content, ...extra });
const staff = (at, content = "reply", extra = {}) => ({ id: id++, message_type: 1, sender_type: "User", private: false, created_at: sec(at), content, ...extra });
const note = (at) => ({ id: id++, message_type: 1, sender_type: "User", private: true, created_at: sec(at), content: "internal" });
const bot = (at) => ({ id: id++, message_type: 1, sender_type: "AgentBot", private: false, created_at: sec(at), content: "auto" });
const system = (at) => ({ id: id++, message_type: 2, sender_type: null, private: false, created_at: sec(at), content: "Assigned" });

const clock = R.makeClock([]);
const NOW = PKT("2026-10-10T12:00");
const one = (msgs) => R.assess(R.buildWaits(msgs)[0], clock, NOW);

console.log("WHATSAPP RESPONSE AUDIT — SELF-TEST\n");

// ---- the clock: the examples as given ----
check("Monday 3pm is due Tuesday 3pm", R.fmtWhen(clock.deadline(PKT("2026-09-21T15:00"))) === "Tue 22 Sep, 15:00");
check("Friday 3pm is due Monday 3pm — the weekend is not counted", R.fmtWhen(clock.deadline(PKT("2026-09-25T15:00"))) === "Mon 28 Sep, 15:00");
check("Thursday 3pm is due Friday 3pm", R.fmtWhen(clock.deadline(PKT("2026-09-24T15:00"))) === "Fri 25 Sep, 15:00");
check("a Saturday message is due at the end of Monday", R.fmtWhen(clock.deadline(PKT("2026-09-26T10:00"))) === "Tue 29 Sep, 00:00");
check("Friday to Monday morning is on time", one([client("2026-09-25T15:00", "when will my file go?"), staff("2026-09-28T10:00")]).verdict === "on-time");
check("Monday to Wednesday is late", one([client("2026-09-21T15:00", "any news on my ECA?"), staff("2026-09-23T11:00")]).verdict === "late");
check("Thursday to Saturday is late", one([client("2026-09-24T15:00", "please call me"), staff("2026-09-26T11:00")]).verdict === "late");
check("the Prophet's Birthday pauses the clock (Thu to Mon)", R.fmtWhen(clock.deadline(PKT("2026-08-27T15:00"))) === "Mon 31 Aug, 15:00");
check("Eid Al Adha pauses the clock for the whole break", R.fmtWhen(clock.deadline(PKT("2026-05-25T15:00"))) === "Mon 1 Jun, 15:00");
check("the Prophet's Birthday uses the announced date, not the predicted one",
  SETTINGS.HOLIDAYS.includes("2026-08-28") && !SETTINGS.HOLIDAYS.includes("2026-08-25"));
check("Pakistan-only holidays are not in the list — the office follows Dubai",
  !SETTINGS.HOLIDAYS.includes("2026-08-14") && !SETTINGS.HOLIDAYS.includes("2026-03-23"));
check("a normal Thursday is still a working day", R.fmtWhen(clock.deadline(PKT("2026-09-24T15:00"))) === "Fri 25 Sep, 15:00");
check("approved leave pauses the clock",
  R.fmtWhen(R.makeClock(["2026-09-22"]).deadline(PKT("2026-09-21T15:00"))) === "Wed 23 Sep, 15:00");
check("working hours skip the weekend", R.hrs(clock.workingBetween(PKT("2026-09-25T15:00"), PKT("2026-09-28T15:00"))) === 24);

// ---- what counts as a reply ----
check("an internal note is not a reply", one([client("2026-09-21T15:00", "update?"), note("2026-09-21T16:00"), staff("2026-09-23T11:00")]).verdict === "late");
check("a bot's automatic reply is not a reply", one([client("2026-09-21T15:00", "hello?"), bot("2026-09-21T15:01"), staff("2026-09-23T11:00")]).verdict === "late");
check("a system message is not a reply", one([client("2026-09-21T15:00", "hello?"), system("2026-09-21T15:02"), staff("2026-09-23T11:00")]).verdict === "late");
check("a reply sent from the phone, with no sender recorded, still counts",
  one([client("2026-09-21T15:00", "hi?"), { id: id++, message_type: 1, sender_type: null, private: false, created_at: sec("2026-09-21T16:00"), content: "yes" }]).verdict === "on-time");
check("a template a person sent counts as a reply",
  one([client("2026-09-21T15:00", "status?"), { id: id++, message_type: 3, sender_type: "User", private: false, created_at: sec("2026-09-21T17:00"), content: "t" }]).verdict === "on-time");

// ---- one wait, not several ----
{
  const w = R.buildWaits([client("2026-09-21T10:00", "hello"), client("2026-09-21T10:01", "need help"), client("2026-09-21T10:02", "urgent"), staff("2026-09-21T11:00")]);
  check("several messages in a row are one wait", w.length === 1 && w[0].client.length === 3);
}
check("the wait is timed from the first message, not the last",
  one([client("2026-09-21T10:00", "q1?"), client("2026-09-22T09:00", "q2?"), staff("2026-09-22T11:00")]).verdict === "late");
check("a reply then a new question starts a new wait",
  R.buildWaits([client("2026-09-21T10:00", "a?"), staff("2026-09-21T11:00"), client("2026-09-21T12:00", "b?"), staff("2026-09-21T13:00")]).length === 2);
check("our own message with no client waiting opens nothing", R.buildWaits([staff("2026-09-21T10:00"), staff("2026-09-21T11:00")]).length === 0);

// ---- messages that need nothing back ----
["ok", "Thank you sir", "thanks 🙏", "JazakAllah", "👍", "ok noted", "Shukriya", "Theek hai"].forEach((t) =>
  check(`"${t}" needs no reply`, R.isAck({ content: t }), JSON.stringify(t)));
["ok when will my visa come", "Hello", "?", "I sent the documents", "Assalam o alaikum sir kab tak hoga"].forEach((t) =>
  check(`"${t}" needs a reply`, !R.isAck({ content: t })));
check("a document with no words needs a reply", !R.isAck({ content: "", attachments: [{ file_type: "file" }] }));
check("a sticker needs no reply", R.isAck({ content: "", content_type: "sticker" }));
check("a thank-you left unanswered is not a delay", one([client("2026-09-21T15:00", "thanks")]).verdict === "no-reply-needed");

// ---- chasing, no reply, and still-in-time ----
check("a follow-up after 2 working hours counts as chasing",
  one([client("2026-09-21T10:00", "status?"), client("2026-09-21T14:00", "any update?"), staff("2026-09-23T10:00")]).followUps === 1);
check("a quick second message is not chasing",
  one([client("2026-09-21T10:00", "status?"), client("2026-09-21T10:05", "of my file"), staff("2026-09-21T11:00")]).followUps === 0);
check("unanswered past the deadline is 'no reply'", one([client("2026-09-21T10:00", "please update me?")]).verdict === "no-reply");
check("unanswered but still inside 24 hours is not counted",
  R.assess(R.buildWaits([client("2026-10-10T08:00", "update?")])[0], clock, NOW).verdict === "pending");

// ---- the comment a reviewer reads ----
{
  const msgs = [client("2026-09-25T15:00", "Did you submit my file?"), client("2026-09-28T19:00", "hello??"), staff("2026-09-29T11:00")];
  const w = R.buildWaits(msgs)[0], a = R.assess(w, clock, NOW);
  const c = R.comment(a, w, "whether the file had been submitted");
  check("the comment gives both times", /Fri 25 Sep, 15:00/.test(c) && /Tue 29 Sep, 11:00/.test(c), c);
  check("the comment gives the allowance", /against 24 allowed/.test(c), c);
  check("the comment says what the client needed", /asking whether the file had been submitted/.test(c), c);
  check("the comment mentions chasing", /follow up 1 time/.test(c), c);
  check("the comment says the weekend was not counted", /Weekend and days off were not counted/.test(c), c);
}
{
  const w = R.buildWaits([client("2026-09-21T10:00", "any update?")])[0], a = R.assess(w, clock, NOW);
  check("a no-reply comment names the deadline", /No reply by the deadline of Tue 22 Sep, 10:00/.test(R.comment(a, w, "")));
}

// ---- config sanity ----
check("the allowance is 24 hours", SETTINGS.ALLOWED_HOURS === 24);
check("the weekend is Saturday and Sunday", SETTINGS.WEEKEND_DAYS.includes(6) && SETTINGS.WEEKEND_DAYS.includes(0) && SETTINGS.WEEKEND_DAYS.length === 2);
check("holidays are written as dates", SETTINGS.HOLIDAYS.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
check("leave dates are written as dates", Object.values(SETTINGS.LEAVE).flat().every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nA rule is not behaving. It is not safe to run this on a real person until it is fixed."); process.exit(1); }
