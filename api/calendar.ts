export const config = { runtime: 'edge' };

const EVENT = {
  title: 'QVEMA Amplify · Soirée de lancement',
  location: 'Palais Brongniart, 16 Place de la Bourse, 75002 Paris',
  description:
    "Soirée de lancement de la plateforme QVEMA Amplify.\\n\\n19h00 — Cocktail d'accueil\\n20h00 — Prises de parole : Michèle Benzeno, Arthur Essebag, Eric Larchevêque, Marc Simoncini, Alice Lhabouz, Jean-Michel Karam, Nicolas Dufourcq (BPI France) et Main Partner.",
  startUtc: '20260604T170000Z',
  endUtc: '20260604T210000Z',
};

function buildIcs(): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QVEMA Amplify//Event//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:qvema-amplify-brongniart-2026@qvema-event-brongniart.vercel.app',
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${EVENT.startUtc}`,
    `DTEND:${EVENT.endUtc}`,
    `SUMMARY:${EVENT.title}`,
    `LOCATION:${EVENT.location.replace(/,/g, '\\,')}`,
    `DESCRIPTION:${EVENT.description}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function icsDataUri(): string {
  const ics = buildIcs();
  const utf8 = new TextEncoder().encode(ics);
  let bin = '';
  for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]);
  return `data:text/calendar;charset=utf-8;base64,${btoa(bin)}`;
}

function googleCalendarUrl(): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: EVENT.title,
    dates: `${EVENT.startUtc}/${EVENT.endUtc}`,
    location: EVENT.location,
    details: EVENT.description.replace(/\\n/g, '\n'),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function outlookCalendarUrl(): string {
  const startIso = '2026-06-04T17:00:00Z';
  const endIso = '2026-06-04T21:00:00Z';
  const params = new URLSearchParams({
    rru: 'addevent',
    path: '/calendar/action/compose',
    subject: EVENT.title,
    startdt: startIso,
    enddt: endIso,
    location: EVENT.location,
    body: EVENT.description.replace(/\\n/g, '\n'),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

export default async function handler(_request: Request): Promise<Response> {
  const body = `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ajouter à mon agenda — QVEMA Amplify</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin:0; padding:0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0b0d10 url('/login-bg.jpg') center/cover no-repeat fixed;
    color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; position: relative; }
  body::before { content: ''; position: fixed; inset: 0; background: linear-gradient(180deg, rgba(11,13,16,.6) 0%, rgba(11,13,16,.8) 100%); z-index: 0; }
  .card { position: relative; z-index: 1; background: rgba(20,23,27,.9); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 36px 28px; width: 100%; max-width: 460px; box-shadow: 0 20px 60px rgba(0,0,0,.5); text-align: center; }
  .icon { width: 56px; height: 56px; border-radius: 50%; background: #d4af3722; border: 2px solid #d4af37; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; color: #d4af37; margin-bottom: 18px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em; }
  .sub { color: rgba(255,255,255,.7); font-size: 14px; line-height: 1.5; margin: 0 0 4px; }
  .meta { color: rgba(255,255,255,.5); font-size: 13px; margin: 0 0 22px; }
  .cal { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.08); }
  .cal-label { font-size: 11px; color: rgba(255,255,255,.5); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 6px; }
  .cal-btn { display: block; padding: 13px 14px; border-radius: 10px; background: rgba(255,255,255,.06); color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; border: 1px solid rgba(255,255,255,.1); transition: background .15s; }
  .cal-btn:hover { background: rgba(255,255,255,.12); }
  .cal-btn-primary { background: linear-gradient(135deg, #d4af37 0%, #b8932d 100%); color: #0b0d10; border-color: transparent; }
  .cal-btn-primary:hover { filter: brightness(1.05); }
  .brand { margin-top: 22px; padding-top: 22px; border-top: 1px solid rgba(255,255,255,.08); }
  .brand img { max-width: 140px; opacity: .8; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">📅</div>
    <h1>Ajouter à mon agenda</h1>
    <p class="sub">QVEMA Amplify · Soirée de lancement</p>
    <p class="meta">Jeudi 4 juin 2026 · 19h00 · Palais Brongniart</p>
    <div class="cal">
      <div class="cal-label">Choisissez votre agenda</div>
      <a class="cal-btn cal-btn-primary" href="${icsDataUri()}" download="qvema-amplify-brongniart.ics">Apple Calendar / Outlook (.ics)</a>
      <a class="cal-btn" href="${googleCalendarUrl()}" target="_blank" rel="noopener">Google Calendar</a>
      <a class="cal-btn" href="${outlookCalendarUrl()}" target="_blank" rel="noopener">Outlook web</a>
    </div>
    <div class="brand"><img src="/logo.png" alt="QVEMA Amplify"></div>
  </div>
</body></html>`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
