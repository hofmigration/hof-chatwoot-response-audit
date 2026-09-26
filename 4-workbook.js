// 4-workbook.js — the sheet.
//
// Four tabs, in the order a reviewer would read them: the headline numbers, one row per
// client with a problem, every individual delay with its evidence, and how the check was
// done. The last tab matters as much as the first: an evaluation someone cannot check
// is one they cannot accept.
const ExcelJS = require("exceljs");
const { SETTINGS } = require("./config");
const { fmtWhen, calText, hrs } = require("./1-rules");

const NAVY = "FF16205E", ROYAL = "FF1F2F8F", LINE = "FFE6E9F1", PANEL = "FFF7F9FC";
const RED = "FFFDECEA", REDTX = "FFB42318", AMBER = "FFFFF5E8", AMBERTX = "FF9A5B0C", GREEN = "FFE9F6EE", GREENTX = "FF1E7A4D";
const thin = { style: "thin", color: { argb: LINE } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };

function header(ws, row, labels) {
  const r = ws.getRow(row);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l;
    c.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = BOX;
  });
  r.height = 22;
}
function title(ws, text, sub) {
  ws.mergeCells("A1:H1");
  const t = ws.getCell("A1");
  t.value = text;
  t.font = { name: "Arial", bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;
  if (sub) {
    ws.mergeCells("A2:H2");
    const s = ws.getCell("A2");
    s.value = sub;
    s.font = { name: "Arial", size: 10, color: { argb: "FF4A5262" } };
    s.alignment = { vertical: "middle", indent: 1, wrapText: true };
    ws.getRow(2).height = 32;
  }
}
const tone = (problem) =>
  /no reply/i.test(problem) ? { fg: RED, tx: REDTX } : /late/i.test(problem) ? { fg: AMBER, tx: AMBERTX } : { fg: PANEL, tx: "FF1F2937" };

async function buildWorkbook(r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HOF Compliance";

  // ---------- 1. Summary ----------
  const s = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  s.columns = [{ width: 44 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  title(s, `WhatsApp response review — ${r.agent}`,
    `${r.periodText}. Rule: a reply within ${SETTINGS.ALLOWED_HOURS} hours; weekends, public holidays and approved leave do not count.`);

  const kpis = [
    ["Clients checked", r.clientsChecked],
    ["Conversations checked", r.conversationsChecked],
    ["Times a client wrote and needed a reply", r.decided],
    ["Answered on time", `${r.onTime}  (${r.onTimePct}%)`],
    ["Late replies", r.late],
    ["No reply at all", r.noReply],
    ["Times a client had to chase", r.chased],
    ["Clients with at least one problem", `${r.clientsWithProblem} of ${r.clientsChecked}`],
    ["Longest wait", r.worst ? `${hrs(r.worst.waitWorkMs)} working hours — ${r.worst.client}` : "—"],
  ];
  let row = 4;
  kpis.forEach(([k, v]) => {
    const a = s.getCell(`A${row}`), b = s.getCell(`B${row}`);
    a.value = k; b.value = v;
    a.font = { name: "Arial", size: 11, color: { argb: "FF3F4A5A" } };
    b.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF16205E" } };
    a.border = BOX; b.border = BOX;
    if (/Late/.test(k) && r.late) b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
    if (/No reply/.test(k) && r.noReply) b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    if (/on time/.test(k)) b.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    row++;
  });

  row += 1;
  header(s, row, ["Type of problem", "Times", "Clients"]);
  row++;
  [["No reply", r.noReply, r.clientsNoReply], ["Late reply", r.late, r.clientsLate], ["Client had to chase", r.chased, r.clientsChased]].forEach(([t, n, c]) => {
    const cells = [s.getCell(`A${row}`), s.getCell(`B${row}`), s.getCell(`C${row}`)];
    cells[0].value = t; cells[1].value = n; cells[2].value = c;
    cells.forEach((x) => { x.border = BOX; x.font = { name: "Arial", size: 10 }; });
    const tn = tone(t);
    cells[0].fill = { type: "pattern", pattern: "solid", fgColor: { argb: tn.fg } };
    row++;
  });

  row += 1;
  header(s, row, ["Set aside, and not counted against her", "Times"]);
  row++;
  [["Needed no reply (thanks, ok, an emoji)", r.noReplyNeeded],
   ["Reviewed: the message needed nothing back", r.setAsideReview],
   ["Client was reached by phone instead", r.setAsidePhone],
   ["Still inside the 24 hours when checked", r.pending]].forEach(([t, n]) => {
    s.getCell(`A${row}`).value = t; s.getCell(`B${row}`).value = n;
    [s.getCell(`A${row}`), s.getCell(`B${row}`)].forEach((x) => { x.border = BOX; x.font = { name: "Arial", size: 10, color: { argb: "FF4A5262" } }; });
    row++;
  });

  // ---------- 2. Cases ----------
  const c = wb.addWorksheet("Cases", { views: [{ state: "frozen", ySplit: 3, showGridLines: false }] });
  c.columns = [{ width: 26 }, { width: 18 }, { width: 22 }, { width: 14 }, { width: 30 }, { width: 70 }, { width: 14 }];
  title(c, "Clients with a problem", "One row per client, worst first. The Every delay tab has each one in full.");
  header(c, 3, ["Client", "Number", "Problems", "Longest wait", "When", "Comment", "Chatwoot"]);
  r.cases.forEach((k, i) => {
    const rw = c.getRow(4 + i);
    rw.values = [k.client, k.phone, k.problemText, `${hrs(k.worstMs)} h`, k.dates.join(", "), k.comment, "Open"];
    rw.getCell(7).value = { text: "Open", hyperlink: k.link };
    rw.getCell(7).font = { name: "Arial", size: 10, color: { argb: ROYAL }, underline: true };
    rw.eachCell((cell, col) => {
      cell.border = BOX;
      cell.alignment = { vertical: "top", wrapText: true };
      if (col !== 7) cell.font = { name: "Arial", size: 10 };
    });
    const tn = tone(k.problemText);
    rw.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: tn.fg } };
    rw.getCell(3).font = { name: "Arial", size: 10, bold: true, color: { argb: tn.tx } };
  });
  if (!r.cases.length) c.getCell("A4").value = "No client had a problem in this period.";

  // ---------- 3. Every delay ----------
  const d = wb.addWorksheet("Every delay", { views: [{ state: "frozen", ySplit: 3, showGridLines: false }] });
  d.columns = [{ width: 24 }, { width: 17 }, { width: 18 }, { width: 44 }, { width: 18 }, { width: 18 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 14 }, { width: 10 }, { width: 64 }, { width: 11 }];
  title(d, "Every delay, with the evidence", "The client's words and the times are as recorded in Chatwoot, in Pakistan time.");
  header(d, 3, ["Client", "Number", "Client wrote", "What they wrote", "Due by", "Reply", "Waited", "Working hrs", "Over by", "Problem", "Chased", "Comment", "Chatwoot"]);
  r.findings.forEach((f, i) => {
    const rw = d.getRow(4 + i);
    rw.values = [
      f.client, f.phone, fmtWhen(f.start), f.said, fmtWhen(f.due),
      f.replyAt ? fmtWhen(f.replyAt) : "No reply",
      calText(f.waitCalMs), hrs(f.waitWorkMs), `${hrs(f.overByMs)} h`,
      f.problem, f.followUps ? `Yes (${f.followUps})` : "No", f.comment, "Open",
    ];
    rw.getCell(13).value = { text: "Open", hyperlink: f.link };
    rw.getCell(13).font = { name: "Arial", size: 10, color: { argb: ROYAL }, underline: true };
    rw.eachCell((cell, col) => {
      cell.border = BOX;
      cell.alignment = { vertical: "top", wrapText: true };
      if (col !== 13) cell.font = { name: "Arial", size: 10 };
    });
    const tn = tone(f.problem);
    rw.getCell(10).fill = { type: "pattern", pattern: "solid", fgColor: { argb: tn.fg } };
    rw.getCell(10).font = { name: "Arial", size: 10, bold: true, color: { argb: tn.tx } };
  });
  if (r.findings.length) d.autoFilter = { from: "A3", to: `M${3 + r.findings.length}` };

  // ---------- 4. How it was checked ----------
  const h = wb.addWorksheet("How it was checked", { views: [{ showGridLines: false }] });
  h.columns = [{ width: 110 }];
  title(h, "How this was checked");
  const lines = [
    `Period: ${r.periodText}. Every WhatsApp conversation assigned to ${r.agent} in Chatwoot, read message by message.`,
    "",
    "WHAT COUNTS AS A DELAY",
    `A client who needs a reply gets one within ${SETTINGS.ALLOWED_HOURS} hours. The clock does not run on Saturday or Sunday, on public holidays, or on approved leave.`,
    "So a message on Friday afternoon is due on Monday afternoon, and a message on Monday afternoon is due on Tuesday afternoon.",
    `Days not counted in this period, besides weekends: ${r.daysOff.length ? r.daysOff.join(", ") : "none"}.`,
    "Holidays are the UAE's official private-sector public holidays, as the main office is in Dubai.",
    ...(r.missingYears && r.missingYears.length ? [`WARNING: no UAE holidays were listed for ${r.missingYears.join(", ")} when this ran, so any holiday in that year was counted as a working day.`] : []),
    "",
    "HOW A WAIT IS MEASURED",
    "A wait starts with the client's first message after the team last spoke, and ends at the next reply from a person.",
    "Several messages in a row from the client are one wait, timed from the first — not several delays.",
    `If the client wrote again at least ${SETTINGS.CHASE_AFTER_HOURS} working hours into a wait with no reply, that is counted as having to chase.`,
    "",
    "WHAT DOES NOT COUNT AS A REPLY",
    "Internal notes (private). System messages such as \"assigned to\". Automatic replies from a bot. Campaign templates nobody sent personally.",
    "",
    "WHAT IS SET ASIDE, AND NOT COUNTED AGAINST HER",
    "Messages that need nothing back: thanks, ok, an emoji, a sticker.",
    r.aiUsed ? "Waits a second reviewer judged as needing no reply — it was told to keep anything in doubt." : "No second review was run for this report.",
    r.phoneUsed ? `Waits where HubSpot shows a connected call to that client in the same stretch. ${r.phoneStats}` : "The phone check did not run, so a client who was phoned instead would still show here.",
    "Waits still inside the 24 hours when the check ran.",
    "",
    "LIMITS WORTH KNOWING",
    "Only Chatwoot is read. A reply by email, or a call not logged in HubSpot, will not be seen.",
    "Only conversations assigned to her are included. A client she answered in a conversation assigned to someone else is not.",
    "Holidays and leave are only excluded if they are listed in config.js — check the list above before relying on this.",
    "The comments are written from the recorded times and messages. Check the conversation before acting on any single row.",
  ];
  lines.forEach((l, i) => {
    const cell = h.getCell(`A${3 + i}`);
    cell.value = l;
    const heading = /^[A-Z][A-Z ,]+$/.test(l);
    cell.font = { name: "Arial", size: heading ? 10 : 10.5, bold: heading, color: { argb: heading ? NAVY : "FF3F4A5A" } };
    cell.alignment = { wrapText: true, vertical: "top" };
  });

  return wb;
}

module.exports = { buildWorkbook };
