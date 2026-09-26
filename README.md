# WhatsApp response audit (Chatwoot)

Reads every WhatsApp conversation assigned to a case manager in Chatwoot and checks, one
client message at a time, whether they got a reply in time. The result is a sheet: the
headline numbers, one row per client with a problem, every delay with its evidence, and
how the check was done.

Read-only. Nothing in Chatwoot or HubSpot is changed.

---

## Setting it up

**New private repo**, e.g. `hof-chatwoot-response-audit`. Upload every file to the root,
and `response-audit.yml` to `.github/workflows/`.

**Secrets** — Settings → Secrets and variables → Actions:

| Secret | What it is | Needed? |
|---|---|---|
| `CHATWOOT_TOKEN` | a Chatwoot **administrator's** access token — Profile settings → Access token | yes |
| `CHATWOOT_URL` | only if HOF's Chatwoot is not `app.chatwoot.com` — the address from your browser, without `/app/...` | if self-hosted |
| `HUBSPOT_TOKEN` | the same token the other agents use — for the phone check | recommended |
| `GEMINI_KEY` | for the second opinion on borderline messages | recommended |
| `RESEND_KEY` | to email the sheet | optional |

**Regenerate the Chatwoot token** before adding it. The one pasted in chat should be
treated as exposed.

## Running it

**Actions → WhatsApp response audit → Run workflow.**

1. **Mode: `discover` first.** It prints the accounts, the agents, how many conversations
   are assigned to Warda, and the *kinds* of message found — no message text. It tells you
   plainly if anything is wrong: a token that isn't an administrator, a name that matches
   nobody, or no conversations assigned at all.
2. **Mode: `report`**, days back `60`. Takes a few minutes. The sheet is under
   **Artifacts** at the bottom of the run. Set *send email* to `true` to have it mailed.

The `agent` box takes any name as it appears in Chatwoot, so the same tool reviews anyone.

---

## The rule

A client who needs a reply gets one within **24 hours**. The clock **stops** on Saturday
and Sunday, on public holidays, and on approved leave.

| Client wrote | Due by | |
|---|---|---|
| Monday 3pm | Tuesday 3pm | a Wednesday reply is **late** |
| Thursday 3pm | Friday 3pm | a Saturday reply is **late** |
| Friday 3pm | Monday 3pm | a Monday morning reply is on time |
| Saturday or Sunday | end of Monday | a Monday reply is on time |

All times are Pakistan time.

## How it reads a conversation — like a person, not a counter

**One wait, not one delay per text.** Four messages in a row from a client are one wait,
timed from the first.

**It only counts a real reply.** Internal notes, system messages like *"assigned to"*,
automatic replies from a bot, and campaign templates nobody sent personally do not count.
A message sent from the phone does count, even though Chatwoot records no sender for it.

**It doesn't count messages that needed nothing back.** *"ok"*, *"thank you sir"*,
*"JazakAllah"*, a thumbs-up, a sticker. But *"ok when will my visa come"* needs an
answer, as does a document with no words, and a plain *"Hello"*.

**It records chasing.** A second client message two or more working hours into a wait,
with no reply in between, is counted as the client having to chase — the pattern behind
complaints.

## Before anything is counted against her

Each late or unanswered wait goes through two checks, and is set aside if either clears it:

1. **Was the client phoned instead?** HubSpot is checked for a *connected* call to that
   client in the same stretch. A call that didn't connect doesn't count.
2. **Did the message really need a reply?** A second reviewer reads that one wait — only
   the messages, never the name or number — and is told to keep anything in doubt.

Everything set aside is counted on the Summary tab, so the report shows what it chose
*not* to hold against her as well as what it did.

---

## Two things to do before using this in her review

**Add her approved leave.** Open `config.js` and list her leave days under `LEAVE`. The
UAE's official 2026 holidays are already in — the office follows Dubai, so no Pakistani
holidays are counted. A missing day off is counted against her, and it's the easiest thing
for her to dispute.

**Each January, add the new year's UAE holidays** — only once they're announced, never
the predicted dates. Islamic holidays move: in 2026 the Prophet's Birthday was predicted
for Tuesday 25 August and actually given on Friday 28 August. The report warns you if the
period runs into a year with no holidays listed.

**Read the "How it was checked" tab.** It lists what the audit can't see: replies by
email, calls not logged in HubSpot, and clients she answered in a conversation assigned
to someone else. Those are the fair grounds for disputing a row, and it's better they're
written down before the conversation than raised during it.

## Changing a rule

Every rule is in `config.js` in plain words, and every rule has a test in `selftest.js` —
`53 passed, 0 failed`. The test runs before each audit, so a rule that stops behaving
stops the run rather than producing a wrong evaluation.
