import nodemailer from 'nodemailer'

// Gmail SMTP via an app password — free, no custom domain. Lazily built so the
// scheduled function picks up secrets from process.env at call time.
let transport: nodemailer.Transporter | null = null

function getTransport(): nodemailer.Transporter | null {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  if (!transport) {
    transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
  }
  return transport
}

// Addresses that can never receive mail: the RFC 2606 / 6761 reserved TLDs and
// example domains, plus anything obviously local. Test and seed accounts land on
// these, and mailing them just bounces into the sending Gmail account. One guard
// here covers every sender, so no future fixture can leak real email.
const UNDELIVERABLE_TLDS = ['.test', '.example', '.invalid', '.localhost', '.local']
const UNDELIVERABLE_DOMAINS = ['example.com', 'example.org', 'example.net', 'test.com', 'localhost']

export function isDeliverable(to: string | null | undefined): boolean {
  const addr = (to ?? '').trim().toLowerCase()
  const at = addr.lastIndexOf('@')
  if (at < 1 || at === addr.length - 1) return false
  const domain = addr.slice(at + 1)
  // Subdomains count too — mail.example.com is as undeliverable as example.com.
  if (UNDELIVERABLE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false
  return !UNDELIVERABLE_TLDS.some((tld) => domain === tld.slice(1) || domain.endsWith(tld))
}

// Shared preflight for every sender: no transport configured, or an address that
// could only bounce, and we don't try.
function ready(to: string, label: string): nodemailer.Transporter | null {
  const t = getTransport()
  if (!t) { console.warn('[email] GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping'); return null }
  if (!isDeliverable(to)) { console.warn(`[email] skipping ${label} to undeliverable address: ${to}`); return null }
  return t
}

export interface ReminderHabit {
  title: string
  target: string
  reminderTime: string | null
  temptationBundle?: string | null
}

// A warm, low-pressure nudge — the cue at the moment of choice, not a guilt trip.
export async function sendReminderEmail(to: string, habit: ReminderHabit): Promise<void> {
  const t = ready(to, 'reminder')
  if (!t) return

  const from = process.env.GMAIL_USER!
  const bundle = habit.temptationBundle?.trim()
  const subject = `Time to ${habit.target || habit.title}`
  const text = [
    `It's time to ${habit.target || habit.title}.`,
    ...(bundle ? ['', `Make it a treat: ${bundle}.`] : []),
    '',
    `Cast today's vote for who you're becoming — even the 2-minute version counts.`,
    '',
    `— One Percent`,
  ].join('\n')
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#211F1B">
      <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#A6A199;margin:0 0 8px">One Percent · Today's vote</p>
      <h2 style="font-size:20px;font-weight:500;margin:0 0 12px">It's time to ${escapeHtml(habit.target || habit.title)}.</h2>
      ${bundle ? `<p style="font-size:14px;line-height:1.5;color:#9A7B62;margin:0 0 14px">Make it a treat — ${escapeHtml(bundle)}.</p>` : ''}
      <p style="font-size:15px;line-height:1.6;color:#6F6B62;margin:0 0 20px">
        Cast today's vote for who you're becoming — even the 2-minute version counts.
      </p>
      <a href="https://one-percent-cb465.web.app/app"
         style="display:inline-block;background:#1B1A17;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 20px;border-radius:10px">
        Cast your vote
      </a>
    </div>`

  await t.sendMail({ from: `One Percent <${from}>`, to, subject, text, html })
}

export interface DigestItem {
  title: string        // identity statement, e.g. "I am someone who moves daily"
  intention: string    // "After I make coffee, I will put on my shoes"
  reminderTime: string | null
}

// The 6am morning brief — every implementation intention scheduled for today,
// laid out so the day starts with a clear plan rather than a blank slate.
export async function sendDigestEmail(to: string, items: DigestItem[]): Promise<void> {
  const t = ready(to, 'digest')
  if (!t) return
  if (items.length === 0) return

  const from = process.env.GMAIL_USER!
  const subject = `Today's intentions — ${items.length} habit${items.length !== 1 ? 's' : ''}`

  const textLines = items.map((it) => {
    const time = it.reminderTime ? ` (${it.reminderTime})` : ''
    return `• ${it.intention}${time}\n  ${it.title}`
  })
  const text = [
    `Good morning. Here's who you're voting for today:`,
    '',
    ...textLines,
    '',
    `Cast each vote at https://one-percent-cb465.web.app/app`,
    '',
    `— One Percent`,
  ].join('\n')

  const rows = items.map((it) => `
    <div style="padding:14px 0;border-bottom:1px solid #ECE9E2">
      <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#A6A199;margin:0 0 4px">
        ${escapeHtml(it.title)}${it.reminderTime ? ` · ${escapeHtml(it.reminderTime)}` : ''}
      </p>
      <p style="font-size:15px;line-height:1.5;color:#211F1B;margin:0">${escapeHtml(it.intention)}</p>
    </div>`).join('')

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#211F1B">
      <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#A6A199;margin:0 0 6px">One Percent · Today's intentions</p>
      <h2 style="font-size:21px;font-weight:500;margin:0 0 6px">Good morning.</h2>
      <p style="font-size:15px;line-height:1.6;color:#6F6B62;margin:0 0 16px">Here's who you're voting for today.</p>
      ${rows}
      <a href="https://one-percent-cb465.web.app/app"
         style="display:inline-block;margin-top:20px;background:#1B1A17;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 20px;border-radius:10px">
        Open today's votes
      </a>
    </div>`

  await t.sendMail({ from: `One Percent <${from}>`, to, subject, text, html })
}

// The Sunday reflection nudge — a gentle invitation to look back on the week.
export async function sendCheckinEmail(to: string): Promise<void> {
  const t = ready(to, 'check-in')
  if (!t) return

  const from = process.env.GMAIL_USER!
  const subject = 'Your weekly check-in is ready'
  const text = [
    `The week's done — nice work showing up.`,
    '',
    `Take five minutes to look back: how did it go, what's one small win, what got in the way, and what's the plan for next week?`,
    '',
    `Reflect here: https://one-percent-cb465.web.app/app/checkin`,
    '',
    `— One Percent`,
  ].join('\n')
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#211F1B">
      <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#A6A199;margin:0 0 8px">One Percent · Weekly check-in</p>
      <h2 style="font-size:20px;font-weight:500;margin:0 0 12px">The week's done — nice work showing up.</h2>
      <p style="font-size:15px;line-height:1.6;color:#6F6B62;margin:0 0 20px">
        Take five minutes to look back: how did it go, what's one small win, what got in the way, and what's the plan for next week?
      </p>
      <a href="https://one-percent-cb465.web.app/app/checkin"
         style="display:inline-block;background:#1B1A17;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 20px;border-radius:10px">
        Start your check-in
      </a>
    </div>`

  await t.sendMail({ from: `One Percent <${from}>`, to, subject, text, html })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

// ── Ia Rā ───────────────────────────────────────────────────────────────────
// A different app borrowing this server's scheduler and Gmail transport.
// https://ia-ra.web.app — a daily record of eating and movement.
//
// Ia Rā is built with no streaks, no scores and no guilt for a missed day, and
// this mail must not undo that in the inbox. So: never mention streaks or how
// many days have been logged, never imply he has fallen behind. This server
// cannot see Ia Rā's data — that lives behind his Firebase login — so it has no
// idea whether today is already logged and must never imply either way.

export interface IaRaLine { subject: string; headline: string; body: string }

// Rotated by date rather than at random, so it is stable if this ever runs
// twice in a day, and so a daily mail does not read like a machine repeating
// itself.
const IARA_LINES: IaRaLine[] = [
  { subject: 'Ia Rā', headline: 'Today is still open.',
    body: 'One press, held for three seconds. That is the whole thing.' },
  { subject: 'Log today', headline: 'A minute before bed.',
    body: 'Food and movement are separate — either one on its own is fine.' },
  { subject: 'Ia Rā', headline: 'Whenever suits.',
    body: 'Nothing to catch up on. Just today, if you want it.' },
  { subject: 'Today in Ia Rā', headline: 'Was it an ordinary day?',
    body: 'If it was, that is one button. If it was not, the fold underneath has the rest.' },
  { subject: 'Log today', headline: 'Still here when you are.',
    body: 'A rest day counts as an answer — it is not the same as not looking.' },
  { subject: 'Ia Rā', headline: 'Two minutes at most.',
    body: 'Pick the profile the day actually was, then hold the button.' },
  { subject: 'Today in Ia Rā', headline: 'Evening.',
    body: 'The record is only worth anything if it is roughly honest, not if it is complete.' },
]

export function iaRaLineFor(localDate: string): IaRaLine {
  // Day number from the local YYYY-MM-DD, so the rotation advances daily and
  // does not depend on the server's own clock or timezone.
  const days = Math.floor(Date.parse(localDate + 'T12:00:00Z') / 86_400_000)
  return IARA_LINES[((days % IARA_LINES.length) + IARA_LINES.length) % IARA_LINES.length]
}

export async function sendIaRaEmail(to: string, line: IaRaLine): Promise<void> {
  const t = ready(to, 'ia-rā')
  if (!t) return

  const from = process.env.GMAIL_USER!
  const url = 'https://ia-ra.web.app'
  const text = [line.headline, '', line.body, '', url, '', '— Ia Rā'].join('\n')
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#3a362f">
      <p style="font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#918a7d;margin:0 0 8px">Ia Rā · Today</p>
      <h2 style="font-size:20px;font-weight:500;margin:0 0 12px">${line.headline}</h2>
      <p style="font-size:15px;line-height:1.6;color:#5e584e;margin:0 0 20px">
        ${line.body}
      </p>
      <a href="${url}"
         style="display:inline-block;background:#3a362f;color:#f4f1ea;text-decoration:none;font-size:14px;font-weight:500;padding:11px 20px;border-radius:12px">
        Log today
      </a>
    </div>`

  await t.sendMail({ from: `Ia Rā <${from}>`, to, subject: line.subject, text, html })
}
