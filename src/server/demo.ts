import { listAccounts, replaceLabels, setThreadAi, upsertAccount, upsertMessages, type Message } from "./db";
import { textToHtml } from "./mime";

/** Seed three fake accounts with a believable inbox, for `tern serve --demo`. */
export function seedDemo() {
  if (listAccounts().length) return;
  const accounts = [
    upsertAccount({ id: "personal", email: "sam.rivera@gmail.com", name: "Sam Rivera", token: null }),
    upsertAccount({ id: "work", email: "sam@northwind.io", name: "Sam Rivera", token: null }),
    upsertAccount({ id: "studio", email: "hello@studiok.dev", name: "Studio K", token: null }),
  ];
  // user labels; like Gmail's, their ids are only unique within an account
  const labelNames = [["Family", "Trips"], ["Search infra", "Receipts"], ["Clients", "Receipts"]];
  labelNames.forEach((names, i) => replaceLabels(accounts[i].id, names.map((name, j) => ({ id: `Label_${j + 1}`, name, type: "user" }))));
  const labelId = (acc: number, name: string) => `Label_${labelNames[acc].indexOf(name) + 1}`;
  const now = Date.now();
  const H = 3600_000;
  type Seed = {
    acc: number; from: [string, string]; subject: string; body: string; ago: number; unread?: boolean; starred?: boolean;
    category: string; priority: number; summary: string; reply?: boolean; replies?: { from: [string, string] | "me"; body: string; ago: number }[];
    html?: boolean; attach?: string; labels?: string[]; spam?: boolean;
  };
  const seeds: Seed[] = [
    { acc: 1, from: ["Priya Natarajan", "priya@northwind.io"], labels: ["Search infra"], subject: "Q4 roadmap review — need your section by Thursday", ago: 0.3, unread: true, category: "important", priority: 3, reply: true,
      summary: "Priya needs your roadmap section by Thursday 5pm for the board deck",
      body: "Hi Sam,\n\nWe're pulling the Q4 roadmap deck together for the board on Monday. Could you send me your section (search infra + the latency work) by Thursday 5pm?\n\nIdeally 3-4 slides: what shipped, what slipped, and what we're betting on next quarter. Rough is fine, I'll polish.\n\nThanks!\nPriya" },
    { acc: 0, from: ["Mom", "linda.rivera@gmail.com"], labels: ["Family"], subject: "Sunday dinner?", ago: 1.2, unread: true, category: "personal", priority: 2, reply: true,
      summary: "Mom asks if you're coming Sunday at 6 and whether to make lasagna",
      body: "Hi honey,\n\nAre you and Jordan still coming Sunday? Dad wants to grill if the weather holds, otherwise I'll make the lasagna. Around 6?\n\nLove, Mom" },
    { acc: 1, from: ["GitHub", "notifications@github.com"], labels: ["Search infra"], subject: "[northwind/search] Fix p99 regression in shard fan-out (#2841)", ago: 1.8, unread: true, category: "updates", priority: 1,
      summary: "Dana approved PR #2841; CI passing, ready to merge",
      body: "@dana-k approved this pull request.\n\nLooks great. The fan-out cap fixes the p99 spike I saw in staging. Ship it.\n\n—\nReply to this email directly or view it on GitHub." },
    { acc: 2, from: ["Marco Bellini", "marco@lumenhotels.com"], labels: ["Clients"], subject: "Re: Website redesign proposal", ago: 2.5, unread: true, category: "work", priority: 3, reply: true,
      summary: "Marco accepts the €18k proposal, asks to start Dec 1 and for a contract",
      body: "Hi Studio K team,\n\nWe've reviewed the proposal internally and we'd love to go ahead with the full package at €18,000. Could we kick off on December 1st?\n\nPlease send over the contract and the first invoice and we'll get it signed this week.\n\nBest,\nMarco Bellini\nHead of Digital, Lumen Hotels",
      replies: [] },
    { acc: 0, from: ["KLM Royal Dutch Airlines", "noreply@klm.com"], labels: ["Trips"], subject: "Your booking confirmation: AMS → SFO, 14 Dec", ago: 4, category: "travel", priority: 1, html: true,
      summary: "Flight KL605 Amsterdam to San Francisco, 14 Dec 10:25, booking ref XK7P2Q",
      body: "Booking reference: XK7P2Q\n\nKL605 Amsterdam (AMS) → San Francisco (SFO)\nSaturday 14 December, departs 10:25, arrives 12:55\nPassenger: Sam Rivera, seat 32A\n\nOnline check-in opens 30 hours before departure." },
    { acc: 1, from: ["Stripe", "receipts@stripe.com"], labels: ["Receipts"], subject: "Your receipt from Vercel Inc. #2381-0042", ago: 6, category: "finance", priority: 0, attach: "receipt-2381-0042.pdf",
      summary: "Vercel Pro team plan receipt, $240.00 charged to Visa 4242",
      body: "Receipt from Vercel Inc.\nAmount paid: $240.00\nDate paid: Nov 20, 2026\nPayment method: Visa •••• 4242\n\nPro plan — 12 seats" },
    { acc: 0, from: ["Jordan Lee", "jordan.lee@icloud.com"], labels: ["Family"], subject: "tickets!!", ago: 7, starred: true, category: "personal", priority: 2,
      summary: "Jordan got two tickets for Fred again.. at Ziggo Dome, 9 Jan",
      body: "GOT THEM. Two tickets for Fred again.. at Ziggo Dome, Jan 9. You owe me €84 😌\n\nJ" },
    { acc: 1, from: ["Linear", "notifications@linear.app"], labels: ["Search infra"], subject: "3 issues assigned to you", ago: 9, category: "updates", priority: 1,
      summary: "Three new issues assigned: SRCH-412, SRCH-418, SRCH-421",
      body: "SRCH-412 Index rebuild stalls on large tenants\nSRCH-418 Add tracing to query planner\nSRCH-421 Flaky test: shard_rebalance_test" },
    { acc: 2, from: ["Figma", "no-reply@figma.com"], labels: ["Clients"], subject: "Ana commented on Lumen — Homepage v3", ago: 11, category: "work", priority: 1,
      summary: "Ana suggests a larger hero image and asks about the booking widget",
      body: "Ana Ruiz commented:\n\"Can we try the hero at full bleed? Also, where does the booking widget go on mobile?\"" },
    { acc: 0, from: ["The Browser", "editor@thebrowser.com"], subject: "Five things worth reading this week", ago: 14, category: "newsletters", priority: 0, html: true,
      summary: "Weekly reading picks: urban heat, the history of fonts, chess engines",
      body: "1. Why cities are getting hotter at night\n2. The 500-year history of the typeface\n3. Inside the chess engine arms race\n4. A field guide to clouds\n5. What we lose when we stop writing by hand" },
    { acc: 1, from: ["Tomás Ortega", "tomas@northwind.io"], subject: "Quick sync on the on-call rotation?", ago: 20, unread: true, category: "work", priority: 2, reply: true,
      summary: "Tomás wants 15 minutes this week to rebalance the on-call rotation",
      body: "Hey Sam, got 15 min this week to talk on-call? With Dana out in December we need to rebalance. Tue or Wed afternoon works for me.\n\nT" },
    { acc: 0, from: ["Zalando", "news@zalando.nl"], subject: "Black Friday starts now: up to 70% off", ago: 22, category: "promotions", priority: 0, html: true,
      summary: "Black Friday sale, up to 70% off selected brands",
      body: "Black Friday is here. Up to 70% off thousands of styles. Free delivery and returns." },
    { acc: 0, from: ["ING", "noreply@ing.nl"], subject: "Your November statement is ready", ago: 26, category: "finance", priority: 1,
      summary: "ING November statement available in the app",
      body: "Your monthly statement for November is now available in the ING app and Mijn ING." },
    { acc: 2, from: ["Elena Fischer", "elena@fischer-arch.de"], labels: ["Clients"], subject: "Portfolio site — small changes", ago: 30, category: "work", priority: 2, reply: true,
      summary: "Elena wants two project photos swapped and the contact email updated",
      body: "Hi! Love how it turned out. Two small things: can we swap the photos on the Haus am See project (use the ones in the shared folder), and change the contact address to studio@fischer-arch.de?\n\nThank you!\nElena",
      replies: [{ from: "me", body: "Hi Elena, of course. I'll get both done tomorrow morning.", ago: 29 }, { from: ["Elena Fischer", "elena@fischer-arch.de"], body: "Perfect, thanks so much!", ago: 28 }] },
    { acc: 1, from: ["Google Calendar", "calendar-notification@google.com"], labels: ["Search infra"], subject: "Invitation: Search infra planning @ Mon 24 Nov 10:00", ago: 33, category: "work", priority: 2,
      summary: "Planning meeting Monday 24 Nov 10:00–11:00, invited by Priya",
      body: "Search infra planning\nMonday 24 Nov 2026 10:00 – 11:00 (CET)\nOrganizer: Priya Natarajan\nJoin with Google Meet" },
    { acc: 0, from: ["Strava", "no-reply@strava.com"], subject: "Jordan gave you kudos", ago: 40, category: "social", priority: 0,
      summary: "Jordan gave kudos on your Sunday long run",
      body: "Jordan Lee gave you kudos on Sunday Long Run (21.1 km)." },
    { acc: 2, from: ["Hetzner", "billing@hetzner.com"], labels: ["Receipts"], subject: "Invoice R0021348821", ago: 48, category: "finance", priority: 0, attach: "R0021348821.pdf",
      summary: "Hetzner monthly invoice, €38.42",
      body: "Dear customer,\n\nYour invoice R0021348821 for €38.42 is attached.\n\nHetzner Online GmbH" },
    { acc: 1, from: ["Dana Kim", "dana@northwind.io"], labels: ["Search infra"], subject: "Re: Latency dashboard", ago: 55, category: "work", priority: 1,
      summary: "Dana shared the new latency dashboard and asks for feedback",
      body: "Here's the dashboard: p50/p95/p99 by region, last 30 days. Let me know if the breakdown by tenant is useful or just noise.",
      replies: [{ from: "me", body: "This is great. Tenant breakdown is useful — can we sort it by p99?", ago: 54 }] },
    { acc: 0, from: ["Airbnb", "automated@airbnb.com"], labels: ["Trips"], subject: "Reminder: Your stay in Lisbon", ago: 70, category: "travel", priority: 1,
      summary: "Lisbon stay 28 Nov – 1 Dec; check-in after 15:00",
      body: "Your stay at Alfama Loft starts 28 November. Check-in is after 15:00. Your host Rui will send the door code the day before." },
    { acc: 2, from: ["Substack", "no-reply@substack.com"], subject: "New post from Design Systems Weekly", ago: 80, category: "newsletters", priority: 0,
      summary: "Article on token naming for multi-brand design systems",
      body: "Naming tokens for multi-brand systems: what we learned after three rebrands." },
    { acc: 0, from: ["Prize Center", "winner@prize-center.top"], subject: "Congratulations! You've won a €500 gift card", ago: 3, unread: true, spam: true, category: "promotions", priority: 0, summary: "",
      body: "Dear customer,\n\nYou have been selected to receive a €500 gift card. Claim it within 24 hours by confirming your details." },
    { acc: 1, from: ["Accounts Payable", "billing@micr0soft-support.com"], subject: "Invoice overdue — action required", ago: 16, unread: true, spam: true, category: "finance", priority: 0, summary: "",
      body: "Your invoice #88213 is overdue. Download the attached document and sign in to avoid suspension of your account." },
    { acc: 2, from: ["Rank Boost", "seo@rankboost.biz"], subject: "Get studiok.dev to #1 on Google", ago: 36, spam: true, category: "promotions", priority: 0, summary: "",
      body: "Hello, I noticed studiok.dev isn't ranking for key terms. We can get you to page one in 30 days, guaranteed." },
  ];
  const msgs: Message[] = [];
  const ai: [string, string, Seed][] = [];
  seeds.forEach((s, i) => {
    const acc = accounts[s.acc];
    const threadId = `demo-${i}`;
    const replies = s.replies ?? [];
    const labels = [s.spam ? "SPAM" : "INBOX", ...(s.starred ? ["STARRED"] : []), ...(s.labels ?? []).map((l) => labelId(s.acc, l))];
    const first: Message = {
      id: `${threadId}-0`, account_id: acc.id, thread_id: threadId, internal_date: now - s.ago * H,
      from_name: s.from[0], from_email: s.from[1], to: [{ name: acc.name, email: acc.email }], cc: [],
      subject: s.subject, snippet: s.body.replace(/\s+/g, " ").slice(0, 140), text: s.body, html: s.html ? htmlCard(s) : "",
      labels: [...labels, ...(s.unread && !replies.length ? ["UNREAD"] : [])], message_id: `<${threadId}-0@demo>`, references: "",
      attachments: s.attach ? [{ id: "a1", filename: s.attach, mimeType: "application/pdf", size: 48213 }] : [],
    };
    msgs.push(first);
    replies.forEach((r, j) => {
      const mine = r.from === "me";
      msgs.push({
        ...first, id: `${threadId}-${j + 1}`, internal_date: now - r.ago * H,
        from_name: mine ? acc.name : (r.from as [string, string])[0], from_email: mine ? acc.email : (r.from as [string, string])[1],
        to: mine ? [{ name: s.from[0], email: s.from[1] }] : [{ name: acc.name, email: acc.email }],
        subject: `Re: ${s.subject}`, snippet: r.body.slice(0, 140), text: r.body, html: "",
        labels: mine ? ["SENT", "INBOX"] : labels, message_id: `<${threadId}-${j + 1}@demo>`, attachments: [],
      });
    });
    if (!s.spam) ai.push([acc.id, threadId, s]);
  });
  upsertMessages(msgs);
  for (const [a, t, s] of ai) setThreadAi(a, t, { category: s.category, priority: s.priority, summary: s.summary, needs_reply: !!s.reply });
}

function htmlCard(s: { from: [string, string]; subject: string; body: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
  <tr><td style="background:#18181b;color:#fff;padding:20px 28px;font-size:18px;font-weight:bold">${s.from[0]}</td></tr>
  <tr><td style="padding:28px;color:#27272a;font-size:15px;line-height:1.6">${textToHtml(s.body)}</td></tr>
  <tr><td style="padding:16px 28px;color:#a1a1aa;font-size:12px;border-top:1px solid #f4f4f5">You received this email because you have an account with ${s.from[0]}.</td></tr>
  </table></td></tr></table></body></html>`;
}
