// audit.js — the run.
//
// MODE=discover  reads Chatwoot and prints its SHAPE — accounts, agents, inboxes, how
//                many conversations are assigned to the person, and what kinds of message
//                exist. No message text is printed. Run this first.
// MODE=report    reads every assigned conversation in the period, judges each wait, and
//                writes the sheet (and emails it if SEND_EMAIL is true).
//
// Read-only throughout. Nothing in Chatwoot or HubSpot is changed.
const fs = require("fs");
const path = require("path");
const { SETTINGS } = require("./config");
const cw = require("./0-chatwoot");
const R = require("./1-rules");
const { review, pickModel } = require("./2-review");
const phone = require("./3-phone");
const { buildWorkbook } = require("./4-workbook");
const { buildEmail, sendEmail } = require("./5-email");

const MODE = String(process.env.MODE || "discover").toLowerCase();
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

async function resolveAccount() {
  const me = await cw.profile();
  const accounts = me.accounts || [];
  const acc = SETTINGS.CHATWOOT_ACCOUNT_ID
    ? accounts.find((a) => String(a.id) === String(SETTINGS.CHATWOOT_ACCOUNT_ID)) || { id: SETTINGS.CHATWOOT_ACCOUNT_ID }
    : accounts[0];
  if (!acc) throw new Error("This token has no Chatwoot account.");
  return { me, accounts, acc };
}

async function findAgent(accId, name) {
  const list = await cw.agents(accId);
  const agents = Array.isArray(list) ? list : (list && list.payload) || [];
  const want = norm(name);
  let hit = agents.filter((a) => norm(a.name) === want || norm(a.available_name) === want);
  if (!hit.length) {
    const parts = want.split(" ");
    hit = agents.filter((a) => parts.every((p) => norm(a.name).includes(p)));
  }
  return { agents, hit };
}

// ============================================================ DISCOVER
async function discover() {
  console.log(`=== Chatwoot discovery — ${SETTINGS.CHATWOOT_URL} ===\n`);
  const { me, accounts, acc } = await resolveAccount();
  console.log(`Token belongs to: ${me.name} (${me.email || "no email"})`);
  console.log(`Accounts it can see:`);
  accounts.forEach((a) => console.log(`  ${a.id}  ${a.name}  — role: ${a.role}`));
  console.log(`Using account ${acc.id}.`);
  if (acc.role && acc.role !== "administrator")
    console.log(`\n!! This token is an "${acc.role}", not an administrator. It may only see its own conversations.\n   The audit needs an administrator's token to see everyone's.`);

  const inb = await cw.inboxes(acc.id).catch(() => null);
  const inboxList = (inb && inb.payload) || [];
  console.log(`\nInboxes (${inboxList.length}):`);
  inboxList.forEach((i) => console.log(`  ${i.id}  ${i.name}  — ${i.channel_type || ""}`));

  const tm = await cw.teams(acc.id);
  const teamList = Array.isArray(tm) ? tm : (tm && tm.payload) || [];
  if (teamList.length) { console.log(`\nTeams (${teamList.length}):`); teamList.forEach((t) => console.log(`  ${t.id}  ${t.name}`)); }

  const { agents, hit } = await findAgent(acc.id, SETTINGS.AGENT_NAME);
  console.log(`\nAgents (${agents.length}):`);
  agents.forEach((a) => console.log(`  ${String(a.id).padEnd(7)} ${a.name}  — ${a.role}`));
  if (hit.length !== 1) {
    console.log(`\n!! "${SETTINGS.AGENT_NAME}" matched ${hit.length} agents${hit.length ? ": " + hit.map((a) => a.name).join(", ") : ""}.`);
    console.log(`   Set the agent input to the exact name shown above.`);
    return;
  }
  const agent = hit[0];
  console.log(`\nMatched "${SETTINGS.AGENT_NAME}" -> agent ${agent.id} (${agent.name})`);

  let convs = await cw.conversationsFor(acc.id, agent.id, false);
  if (!convs.length) convs = await cw.conversationsFor(acc.id, agent.id, true);
  const since = Date.now() - SETTINGS.DAYS_BACK * R.DAY;
  const inPeriod = convs.filter((c) => cw.toMs(c.last_activity_at || c.timestamp) >= since);
  const byStatus = convs.reduce((a, c) => ((a[c.status] = (a[c.status] || 0) + 1), a), {});
  const clients = new Set(convs.map((c) => (c.meta && c.meta.sender && c.meta.sender.id) || c.id));
  console.log(`\nConversations assigned to ${agent.name}: ${convs.length} (${clients.size} clients)`);
  console.log(`  by status: ${JSON.stringify(byStatus)}`);
  console.log(`  active in the last ${SETTINGS.DAYS_BACK} days: ${inPeriod.length}`);
  if (!convs.length) {
    console.log(`\n!! Nothing is assigned to ${agent.name}. Chatwoot may not be how cases are split here —`);
    console.log(`   check whether each case manager has their own inbox or team above, and tell Claude which.`);
    return;
  }

  // the shape of a few conversations, without printing anything a client wrote
  const sample = inPeriod.slice(0, 3);
  for (const c of sample) {
    const msgs = await cw.messagesSince(acc.id, c.id, since);
    const byType = {}, bySender = {};
    let priv = 0, nullSenderOut = 0, withFile = 0;
    for (const m of msgs) {
      byType[m.message_type] = (byType[m.message_type] || 0) + 1;
      const st = m.sender_type || (m.sender && m.sender.type) || "none";
      bySender[st] = (bySender[st] || 0) + 1;
      if (m.private) priv++;
      if (String(m.message_type) === "1" && !m.sender_type && !(m.sender && m.sender.type)) nullSenderOut++;
      if ((m.attachments && m.attachments.length) || m.attachment) withFile++;
    }
    const waits = R.buildWaits(msgs);
    console.log(`\n  sample conversation ${c.id}: ${msgs.length} messages read in the period`);
    console.log(`    message_type counts: ${JSON.stringify(byType)}   (0 client, 1 reply, 2 system, 3 template)`);
    console.log(`    sender_type counts:  ${JSON.stringify(bySender)}`);
    console.log(`    internal notes: ${priv}   with a file: ${withFile}   replies with no sender recorded: ${nullSenderOut}`);
    console.log(`    fields on a message: ${msgs[0] ? Object.keys(msgs[0]).join(", ") : "—"}`);
    console.log(`    waits found: ${waits.length}`);
  }
  console.log(`\n=== Looks usable. Run again with mode = report. ===`);
  if (process.env.GEMINI_KEY) console.log(`Second-opinion model: ${await pickModel()}`);
  console.log(`Phone check: ${process.env.HUBSPOT_TOKEN ? "on" : "off (no HUBSPOT_TOKEN)"}`);
}

// ============================================================ REPORT
async function report() {
  const now = Date.now();
  const { acc } = await resolveAccount();
  const { hit } = await findAgent(acc.id, SETTINGS.AGENT_NAME);
  if (hit.length !== 1) throw new Error(`"${SETTINGS.AGENT_NAME}" matched ${hit.length} agents. Run discover to see the exact names.`);
  const agent = hit[0];

  const periodStart = now - SETTINGS.DAYS_BACK * R.DAY;
  const readFrom = periodStart - SETTINGS.LOOKBACK_BUFFER_DAYS * R.DAY;
  const leave = (SETTINGS.LEAVE[SETTINGS.AGENT_NAME] || SETTINGS.LEAVE[agent.name] || []);
  const clock = R.makeClock(leave);
  const periodText = `${R.fmtWhen(periodStart).replace(/, \d\d:\d\d$/, "")} to ${R.fmtWhen(now).replace(/, \d\d:\d\d$/, "")} (${SETTINGS.DAYS_BACK} days)`;

  console.log(`=== WhatsApp response review — ${agent.name} — ${periodText} ===`);
  let convs = await cw.conversationsFor(acc.id, agent.id, false);
  if (!convs.length) convs = await cw.conversationsFor(acc.id, agent.id, true);
  convs = convs.filter((c) => cw.toMs(c.last_activity_at || c.timestamp) >= periodStart);
  console.log(`${convs.length} conversation(s) active in the period. Reading them…`);

  const findings = [];
  const counts = { onTime: 0, late: 0, noReply: 0, noReplyNeeded: 0, pending: 0, setAsideReview: 0, setAsidePhone: 0, chased: 0 };
  const clientsChecked = new Set();
  let reviews = 0, done = 0;

  for (const c of convs) {
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${convs.length}`);
    const sender = (c.meta && c.meta.sender) || {};
    const clientKey = sender.id || sender.phone_number || c.id;
    let msgs;
    try { msgs = await cw.messagesSince(acc.id, c.id, readFrom); }
    catch (e) { console.log(`  could not read conversation ${c.id}: ${e.message}`); continue; }

    const waits = R.buildWaits(msgs).filter((w) => cw.toMs(w.client[0].created_at) >= periodStart);
    if (!waits.length) continue;
    clientsChecked.add(clientKey);

    for (const w of waits) {
      const a = R.assess(w, clock, now);
      if (a.verdict === "no-reply-needed") { counts.noReplyNeeded++; continue; }
      if (a.verdict === "pending") { counts.pending++; continue; }
      if (a.verdict === "on-time") { counts.onTime++; continue; }

      // late or unanswered: before counting it, check the phone, then the second opinion
      const ph = await phone.reachedByPhone(sender.phone_number, a.start, a.replyAt || now);
      if (ph.reachedAt && ph.reachedAt <= a.due) { counts.setAsidePhone++; continue; }

      let asked = "";
      if (reviews < SETTINGS.MAX_AI_REVIEWS) {
        const rv = await review(w, a);
        if (rv && !rv.error) {
          reviews++;
          if (rv.needsReply === false) { counts.setAsideReview++; continue; }
          asked = rv.asked || "";
        }
      }

      if (a.verdict === "late") counts.late++; else counts.noReply++;
      if (a.followUps) counts.chased++;
      let note = R.comment(a, w, asked);
      if (ph.reachedAt) note += ` Reached by phone on ${R.fmtWhen(ph.reachedAt)}, which was also after the deadline.`;

      findings.push({
        clientKey, client: sender.name || "Unknown", phone: sender.phone_number || "",
        link: cw.conversationLink(acc.id, c.id),
        start: a.start, due: a.due, replyAt: a.replyAt,
        said: R.snippet(w.client[0], 120),
        waitCalMs: a.waitCalMs, waitWorkMs: a.waitWorkMs, overByMs: a.overByMs,
        problem: a.verdict === "late" ? "Late reply" : "No reply",
        followUps: a.followUps, comment: note,
      });
    }
  }

  // one row per client, worst first
  const byClient = new Map();
  for (const f of findings) {
    const k = byClient.get(f.clientKey) || { client: f.client, phone: f.phone, link: f.link, late: 0, none: 0, chased: 0, worstMs: 0, dates: [], worst: null };
    if (f.problem === "Late reply") k.late++; else k.none++;
    if (f.followUps) k.chased++;
    k.dates.push(R.fmtWhen(f.start).replace(/, \d\d:\d\d$/, ""));
    if (f.waitWorkMs > k.worstMs) { k.worstMs = f.waitWorkMs; k.worst = f; }
    byClient.set(f.clientKey, k);
  }
  const cases = [...byClient.values()].map((k) => ({
    ...k,
    dates: [...new Set(k.dates)],
    problemText: [k.none && `${k.none} with no reply`, k.late && `${k.late} late`, k.chased && `chased ${k.chased}×`].filter(Boolean).join(", "),
    comment: k.worst.comment,
  })).sort((a, b) => (b.none - a.none) || (b.worstMs - a.worstMs));

  const decided = counts.onTime + counts.late + counts.noReply;
  const worst = findings.reduce((a, f) => (!a || f.waitWorkMs > a.waitWorkMs ? f : a), null);
  const inPeriod = (d) => { const t = Date.parse(d + "T00:00:00+05:00"); return t >= periodStart - R.DAY && t <= now; };
  const daysOff = [...SETTINGS.HOLIDAYS.filter(inPeriod).map((d) => d + " (holiday)"), ...leave.filter(inPeriod).map((d) => d + " (leave)")];

  // a year the period touches with no holidays listed at all is almost certainly a list
  // nobody updated, not a year with no holidays
  const years = [...new Set([new Date(periodStart).getUTCFullYear(), new Date(now).getUTCFullYear()])];
  const missingYears = years.filter((y) => !SETTINGS.HOLIDAYS.some((d) => d.startsWith(String(y))));
  if (missingYears.length)
    console.log(`\n!! No UAE holidays are listed for ${missingYears.join(", ")}. Add the announced dates to config.js before relying on this report.`);
  const r = {
    agent: agent.name, periodText, daysOff, missingYears,
    clientsChecked: clientsChecked.size, conversationsChecked: convs.length,
    decided, onTime: counts.onTime, onTimePct: decided ? Math.round((counts.onTime / decided) * 100) : 100,
    late: counts.late, noReply: counts.noReply, chased: counts.chased,
    clientsWithProblem: cases.length,
    clientsLate: cases.filter((k) => k.late).length, clientsNoReply: cases.filter((k) => k.none).length, clientsChased: cases.filter((k) => k.chased).length,
    noReplyNeeded: counts.noReplyNeeded, setAsideReview: counts.setAsideReview, setAsidePhone: counts.setAsidePhone, pending: counts.pending,
    worst: worst ? { waitWorkMs: worst.waitWorkMs, client: worst.client } : null,
    cases, findings: findings.sort((a, b) => b.waitWorkMs - a.waitWorkMs),
    aiUsed: reviews > 0,
    phoneUsed: !!process.env.HUBSPOT_TOKEN && SETTINGS.USE_PHONE_CHECK,
    phoneStats: `${phone.stats.matched} of ${phone.stats.looked} clients were found in HubSpot by phone number.`,
  };

  // ---- the log ----
  console.log(`\n===== ${agent.name.toUpperCase()} — ${periodText} =====`);
  console.log(`Clients checked: ${r.clientsChecked}   conversations: ${r.conversationsChecked}`);
  console.log(`Needed a reply: ${decided}   on time: ${r.onTime} (${r.onTimePct}%)   late: ${r.late}   no reply: ${r.noReply}   chased: ${r.chased}`);
  console.log(`Clients with a problem: ${r.clientsWithProblem} of ${r.clientsChecked}`);
  console.log(`Set aside: ${r.noReplyNeeded} needed no reply, ${r.setAsideReview} by review, ${r.setAsidePhone} reached by phone, ${r.pending} still in time`);
  if (r.phoneUsed) console.log(`Phone check: ${r.phoneStats}`);

  // ---- the files ----
  fs.mkdirSync(SETTINGS.OUT_DIR, { recursive: true });
  const stamp = new Date(now).toISOString().slice(0, 10);
  const safeName = agent.name.replace(/[^A-Za-z0-9]+/g, "-");
  const xlsx = path.join(SETTINGS.OUT_DIR, `WhatsApp-response-${safeName}-${stamp}.xlsx`);
  const wb = await buildWorkbook(r);
  await wb.xlsx.writeFile(xlsx);
  const html = buildEmail(r);
  fs.writeFileSync(path.join(SETTINGS.OUT_DIR, "summary.html"), html);
  console.log(`\nWrote ${xlsx} — download it from this run's Artifacts.`);

  if (!SETTINGS.SEND_EMAIL) { console.log(`Not emailed (send_email is off).`); return; }
  const content = fs.readFileSync(xlsx).toString("base64");
  const ok = await sendEmail(
    `WhatsApp response review — ${agent.name}: ${r.clientsWithProblem} of ${r.clientsChecked} clients waited too long`,
    html, { filename: path.basename(xlsx), content });
  if (ok) console.log(`Emailed to ${SETTINGS.REPORT_TO}.`);
  else { console.log(`!! The email was not sent. The sheet is still in Artifacts.`); process.exitCode = 1; }
}

(async () => {
  if (!process.env.CHATWOOT_TOKEN) { console.log("!! No CHATWOOT_TOKEN secret."); process.exit(1); }
  try { MODE === "report" ? await report() : await discover(); }
  catch (e) { console.error(`\nFAILED: ${e.message}`); process.exit(1); }
})();
