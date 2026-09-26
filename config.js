// config.js — WhatsApp response audit (Chatwoot). SAFE TO EDIT.
//
// This is a performance check on a real person, so the rules are written out here in
// plain terms and repeated in the report. If a rule is wrong, change it here — never
// quietly in the code.

const SETTINGS = {
  // ---- who, and over what period ----
  AGENT_NAME: process.env.AGENT || "Warda Badar",
  DAYS_BACK: Number(process.env.DAYS_BACK || 60),      // the period being reviewed

  // ---- Chatwoot ----
  // If HOF's Chatwoot is not app.chatwoot.com, set the CHATWOOT_URL secret to the address
  // you use in the browser, without the /app/... part.
  CHATWOOT_URL: process.env.CHATWOOT_URL || "https://app.chatwoot.com",
  CHATWOOT_ACCOUNT_ID: process.env.CHATWOOT_ACCOUNT_ID || "",   // blank = the token's first account
  CHATWOOT_RPS: 2,                                             // requests per second, kept gentle

  // ---- THE RULE ----
  // A client who needs a reply gets one within 24 hours, but the clock does not run on
  // the weekend, on public holidays, or on the agent's approved leave. So:
  //   Monday 3pm   -> due Tuesday 3pm     (Wednesday is late)
  //   Thursday 3pm -> due Friday 3pm      (Saturday is late)
  //   Friday 3pm   -> due Monday 3pm      (the weekend is not counted)
  //   Saturday     -> due end of Monday
  ALLOWED_HOURS: 24,
  TZ_OFFSET_HOURS: 5,          // Pakistan time, like the other agents; no daylight saving
  WEEKEND_DAYS: [6, 0],        // Saturday and Sunday

  // UAE public holidays — the main office is in Dubai, so these are the only ones that
  // apply. These are the PRIVATE-SECTOR dates as officially announced for 2026 (federal
  // government staff had an extra day at each Eid; that does not apply to HOF).
  //
  // Islamic holidays follow the moon and can be moved by Cabinet decision, so NEVER enter
  // a predicted date — only the one that was announced. The Prophet's Birthday in 2026 is
  // the example: predicted for Tue 25 Aug, actually given on Fri 28 Aug.
  //
  // ADD NEXT YEAR'S DATES once they are announced. The report warns when the period being
  // reviewed runs into a year that has none listed.
  HOLIDAYS: [
    "2026-01-01",                              // New Year's Day
    "2026-03-19", "2026-03-20", "2026-03-21",  // Eid Al Fitr
    "2026-05-26",                              // Arafat Day
    "2026-05-27", "2026-05-28", "2026-05-29",  // Eid Al Adha
    "2026-06-15",                              // Hijri New Year (moved to the Monday)
    "2026-08-28",                              // Prophet's Birthday (moved to the Friday)
    "2026-12-02", "2026-12-03",                // UAE National Day
  ],

  // Approved leave, per person. The clock pauses on these days too.
  LEAVE: {
    "Warda Badar": [
      // "2026-09-03",
    ],
  },

  // A second client message this long after the first, with no reply in between, is
  // counted as the client having to chase.
  CHASE_AFTER_HOURS: 2,

  // How far before the period to read, so a wait that started just before it is timed
  // from its real start rather than from the first day of the period.
  LOOKBACK_BUFFER_DAYS: 7,

  // ---- the second opinion ----
  // Only waits that already look late or unanswered are reviewed. The reviewer can set a
  // wait aside when the client's message genuinely needed nothing back, and writes a few
  // words on what the client was asking for. Nothing else is sent to it.
  USE_AI_REVIEW: true,
  AI_MODELS: ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"],
  MAX_AI_REVIEWS: 250,

  // ---- the phone check ----
  // Before calling anything "no reply", HubSpot is checked for a connected call to that
  // client in the same stretch. A client who was phoned was not left waiting.
  USE_PHONE_CHECK: true,
  CONNECTED_DISPOSITION: "f240bbac-87c9-4f6e-bf70-924b57d47db7",  // HubSpot's default "Connected"
  CONNECTED_MIN_SECONDS: 60,   // or any call at least this long

  // ---- the report ----
  REPORT_TO: process.env.REPORT_TO || "razaali@hofmigration.com",
  FROM_EMAIL: process.env.FROM_EMAIL || "onboarding@resend.dev",
  SEND_EMAIL: String(process.env.SEND_EMAIL || "").toLowerCase() === "true",
  OUT_DIR: "out",
};

// Short messages that need nothing back. Every word of a message has to be on this list
// for it to count — "ok when will my visa come" is not an acknowledgement.
const ACK_WORDS = new Set((
  "ok okay okk okkk k kk thanks thank thankyou thanku thnx thx ty tysm you u noted sure fine great " +
  "perfect done received got it alright cool welcome shukriya shukria shukran jazakallah jazak allah " +
  "khair khayr theek thik hai he acha achha accha g ji jee han haan yes ya yup yeah bilkul mashallah " +
  "alhamdulillah inshallah good nice sir madam mam maam bro brother sis sister bhai sahab sb so much " +
  "very a lot lots dear and 👍 🙏 ❤️ 👌 🙂 😊"
).split(/\s+/));

module.exports = { SETTINGS, ACK_WORDS };
