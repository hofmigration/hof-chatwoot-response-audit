// 5-email.js — the headline in the email, the detail in the attached sheet.
const { SETTINGS } = require("./config");
const { hrs } = require("./1-rules");

const C = { navy: "#16205e", royal: "#1f2f8f", ink: "#1f2937", body: "#3f4a5a", soft: "#868e9b", line: "#e6e9f1",
  panel: "#f7f9fc", bad: "#b42318", badbg: "#fdecea", warn: "#9a5b0c", warnbg: "#fff5e8", good: "#1e7a4d", goodbg: "#e9f6ee" };
const F = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function tile(value, label, fg, bg) {
  return `<td width="25%" align="center" style="background:${bg};border-radius:6px;padding:13px 6px">
    <div style="font:700 24px/1 ${F};color:${fg}">${esc(value)}</div>
    <div style="font:600 10px/1.3 ${F};letter-spacing:.06em;text-transform:uppercase;color:${fg};margin-top:5px">${esc(label)}</div></td>`;
}

function buildEmail(r) {
  const top = r.cases.slice(0, 10).map((k) => `<tr>
    <td style="padding:9px 10px;border-top:1px solid ${C.line};font:600 13px/1.4 ${F};color:${C.ink}">${esc(k.client)}<div style="font:400 11.5px/1.4 ${F};color:${C.soft}">${esc(k.phone)}</div></td>
    <td style="padding:9px 10px;border-top:1px solid ${C.line};font:400 12.5px/1.5 ${F};color:${/no reply/i.test(k.problemText) ? C.bad : C.warn}">${esc(k.problemText)}</td>
    <td align="right" style="padding:9px 10px;border-top:1px solid ${C.line};font:700 12.5px/1.4 ${F};color:${C.ink};white-space:nowrap">${hrs(k.worstMs)} h</td>
  </tr>`).join("");

  const banner = r.clientsWithProblem
    ? { bg: C.badbg, fg: C.bad, t: `<strong>${r.clientsWithProblem} of ${r.clientsChecked} clients</strong> waited too long at least once — ${r.late} late ${r.late === 1 ? "reply" : "replies"} and ${r.noReply} with no reply.` }
    : { bg: C.goodbg, fg: C.good, t: `<strong>No delays found.</strong> Every client who needed a reply got one within the allowance.` };

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f6;padding:26px 12px"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background-color:${C.navy};background-image:linear-gradient(120deg,${C.navy},${C.royal});padding:22px 26px">
  <div style="font:700 20px/1.3 ${F};color:#fff">WhatsApp response review — ${esc(r.agent)}</div>
  <div style="font:400 12.5px/1.5 ${F};color:#aab0d4;margin-top:5px">${esc(r.periodText)}</div>
</td></tr>
<tr><td style="padding:22px 26px">
  <table role="presentation" width="100%" style="margin:0 0 16px"><tr><td style="background:${banner.bg};border-left:4px solid ${banner.fg};padding:13px 16px;font:400 14px/1.6 ${F};color:${banner.fg}">${banner.t}</td></tr></table>
  <table role="presentation" width="100%" cellspacing="8" style="margin:0 -8px 14px"><tr>
    ${tile(r.clientsChecked, "clients checked", C.navy, C.panel)}
    ${tile(r.onTimePct + "%", "answered on time", C.good, C.goodbg)}
    ${tile(r.late, "late replies", C.warn, C.warnbg)}
    ${tile(r.noReply, "no reply", C.bad, C.badbg)}
  </tr></table>
  <div style="font:400 13px/1.6 ${F};color:${C.body};margin:0 0 14px">
    The allowance is ${SETTINGS.ALLOWED_HOURS} hours, with weekends${r.daysOff.length ? ", public holidays and approved leave" : ""} not counted. ${r.chased ? `Clients had to chase ${r.chased} time${r.chased > 1 ? "s" : ""}.` : ""}
  </div>
  ${top ? `<div style="font:700 14px/1.3 ${F};color:${C.navy};margin:18px 0 8px">Worst cases</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:6px;border-collapse:collapse">${top}</table>` : ""}
  <div style="font:400 12.5px/1.6 ${F};color:${C.soft};margin-top:16px">
    Every delay is in the attached sheet with the client's own words, the times, and a link to the conversation.
    The <b>How it was checked</b> tab sets out the rules, what was set aside, and the limits — worth reading before this is used in a review.
  </div>
</td></tr>
<tr><td style="background:${C.panel};border-top:1px solid ${C.line};padding:15px 26px;font:400 11.5px/1.6 ${F};color:${C.soft}">
  <strong style="color:${C.body}">Ali Raza</strong> · Compliance · HOF Migration<br>Read-only. Nothing in Chatwoot or HubSpot was changed.
</td></tr></table></td></tr></table>`;
}

async function sendEmail(subject, html, attachment) {
  if (!process.env.RESEND_KEY) { console.log("No RESEND_KEY — not emailed."); return false; }
  const body = { from: SETTINGS.FROM_EMAIL, to: [SETTINGS.REPORT_TO], subject, html };
  if (attachment) body.attachments = [attachment];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 250);
    console.log(`Email failed: ${res.status} ${t}`);
    if (res.status === 403) console.log("  The built-in sender only reaches the address the Resend account was registered with.");
    return false;
  }
  return true;
}

module.exports = { buildEmail, sendEmail };
