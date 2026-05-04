export const config = { runtime: 'edge' };

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function makeToken(guestId: string, response: string, secret: string): Promise<string> {
  return hmac(secret, `${guestId}:${response}`);
}

async function supabasePatch(id: string, payload: Record<string, unknown>): Promise<Response> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SECRET_KEY!;
  return fetch(`${url}/rest/v1/guests?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
}

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

function htmlPage(opts: {
  title: string;
  heading: string;
  message: string;
  tone: 'success' | 'error' | 'info';
  calendar?: boolean;
}): Response {
  const accent = opts.tone === 'success' ? '#10b981' : opts.tone === 'error' ? '#ef4444' : '#d4af37';
  const calendarBlock = opts.calendar
    ? `
    <div class="cal">
      <div class="cal-label">Ajoutez l'événement à votre agenda</div>
      <a class="cal-btn cal-btn-primary" href="${icsDataUri()}" download="qvema-amplify-brongniart.ics">📅 Apple / Outlook (fichier .ics)</a>
      <a class="cal-btn" href="${googleCalendarUrl()}" target="_blank" rel="noopener">Google Calendar</a>
      <a class="cal-btn" href="${outlookCalendarUrl()}" target="_blank" rel="noopener">Outlook web</a>
    </div>`
    : '';
  const socialBlock = opts.tone === 'error'
    ? ''
    : `
    <div class="social">
      <div class="social-label">Suivez-nous sur les réseaux sociaux</div>
      <div class="social-icons">
        <a href="https://www.facebook.com/qvema" target="_blank" rel="noopener"><img src="/social/facebook.png" alt="Facebook" width="32" height="32"></a>
        <a href="https://www.instagram.com/qvema/" target="_blank" rel="noopener"><img src="/social/instagram.png" alt="Instagram" width="32" height="32"></a>
        <a href="https://www.tiktok.com/@qvema_off" target="_blank" rel="noopener"><img src="/social/tiktok.png" alt="TikTok" width="32" height="32"></a>
        <a href="https://www.snapchat.com/p/84d4ef21-ddb1-474c-aac0-13ed7dde095a/1536491037806592" target="_blank" rel="noopener"><img src="/social/snapchat.png" alt="Snapchat" width="32" height="32"></a>
        <a href="https://www.youtube.com/@QVEMA" target="_blank" rel="noopener"><img src="/social/youtube.png" alt="YouTube" width="32" height="32"></a>
      </div>
      <a class="social-site" href="https://www.quiveutetremonassocie.com" target="_blank" rel="noopener">www.quiveutetremonassocie.com</a>
    </div>`;
  const body = `<!DOCTYPE html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin:0; padding:0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0b0d10 url('/login-bg.jpg') center/cover no-repeat fixed;
    color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; position: relative; }
  body::before { content: ''; position: fixed; inset: 0; background: linear-gradient(180deg, rgba(11,13,16,.6) 0%, rgba(11,13,16,.8) 100%); z-index: 0; }
  .card { position: relative; z-index: 1; background: rgba(20,23,27,.9); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 40px 32px; width: 100%; max-width: 460px; box-shadow: 0 20px 60px rgba(0,0,0,.5); text-align: center; }
  .icon { width: 56px; height: 56px; border-radius: 50%; background: ${accent}22; border: 2px solid ${accent}; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; color: ${accent}; margin-bottom: 18px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em; }
  p { color: rgba(255,255,255,.7); font-size: 14px; line-height: 1.5; margin: 0; }
  .cal { margin-top: 24px; padding-top: 22px; border-top: 1px solid rgba(255,255,255,.08); display: flex; flex-direction: column; gap: 8px; }
  .cal-label { font-size: 11px; color: rgba(255,255,255,.5); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 6px; }
  .cal-btn { display: block; padding: 11px 14px; border-radius: 10px; background: rgba(255,255,255,.06); color: #fff; text-decoration: none; font-size: 13.5px; font-weight: 600; border: 1px solid rgba(255,255,255,.1); transition: background .15s; }
  .cal-btn:hover { background: rgba(255,255,255,.12); }
  .cal-btn-primary { background: linear-gradient(135deg, #d4af37 0%, #b8932d 100%); color: #0b0d10; border-color: transparent; }
  .cal-btn-primary:hover { filter: brightness(1.05); background: linear-gradient(135deg, #d4af37 0%, #b8932d 100%); }
  .social { margin-top: 24px; padding-top: 22px; border-top: 1px solid rgba(255,255,255,.08); }
  .social-label { font-size: 11px; color: rgba(255,255,255,.55); text-transform: uppercase; letter-spacing: 1.4px; font-weight: 600; margin-bottom: 14px; }
  .social-icons { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
  .social-icons a { display: inline-flex; opacity: .85; transition: opacity .15s; }
  .social-icons a:hover { opacity: 1; }
  .social-icons img { display: block; width: 32px; height: 32px; }
  .social-site { display: inline-block; margin-top: 16px; color: #fff; text-decoration: none; font-size: 13.5px; font-weight: 600; letter-spacing: .3px; opacity: .9; }
  .social-site:hover { opacity: 1; text-decoration: underline; }
  .brand { margin-top: 22px; padding-top: 22px; border-top: 1px solid rgba(255,255,255,.08); }
  .brand img { max-width: 140px; opacity: .8; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${opts.tone === 'success' ? '✓' : opts.tone === 'error' ? '!' : 'ℹ'}</div>
    <h1>${opts.heading}</h1>
    <p>${opts.message}</p>
    ${calendarBlock}
    ${socialBlock}
    <div class="brand"><img src="/logo.png" alt="QVEMA Amplify"></div>
  </div>
</body></html>`;
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

const RSVP_LABELS: Record<string, string> = {
  oui: 'confirmé',
  non: 'décliné',
};

export default async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const guest = url.searchParams.get('guest');
    const response = url.searchParams.get('response');
    const token = url.searchParams.get('token');
    const secret = process.env.RSVP_SECRET;

    if (!guest || !response || !token || !secret) {
      return htmlPage({
        title: 'Lien invalide',
        heading: 'Lien d\'invitation invalide',
        message: 'Ce lien est incomplet. Merci de contacter l\'organisation.',
        tone: 'error',
      });
    }

    if (!RSVP_LABELS[response]) {
      return htmlPage({
        title: 'Réponse non reconnue',
        heading: 'Réponse non reconnue',
        message: 'Le format de la réponse est invalide.',
        tone: 'error',
      });
    }

    const expected = await makeToken(guest, response, secret);
    if (expected !== token) {
      return htmlPage({
        title: 'Lien invalide',
        heading: 'Lien d\'invitation invalide',
        message: 'Le lien de confirmation est expiré ou a été altéré. Merci de contacter l\'organisation.',
        tone: 'error',
      });
    }

    const rsvpLabel = RSVP_LABELS[response];
    const res = await supabasePatch(guest, {
      rsvp: rsvpLabel,
    });
    if (!res.ok) {
      return htmlPage({
        title: 'Erreur',
        heading: 'Une erreur est survenue',
        message: 'Impossible d\'enregistrer votre réponse. Merci de contacter l\'organisation.',
        tone: 'error',
      });
    }
    const rows = (await res.json()) as Record<string, unknown>[];
    if (rows.length === 0) {
      return htmlPage({
        title: 'Invité introuvable',
        heading: 'Invité introuvable',
        message: 'Cette invitation n\'est plus valide. Merci de contacter l\'organisation.',
        tone: 'error',
      });
    }

    const firstName = (rows[0].first_name as string) || '';
    const greet = firstName ? `Merci ${firstName} !` : 'Merci !';

    if (response === 'oui') {
      return htmlPage({
        title: 'Présence confirmée',
        heading: greet,
        message: 'Votre présence est confirmée pour la soirée de lancement QVEMA Amplify, jeudi 4 juin 2026 au Palais Brongniart, à partir de 19h00.',
        tone: 'success',
        calendar: true,
      });
    }
    return htmlPage({
      title: 'Réponse enregistrée',
      heading: greet,
      message: 'Nous avons bien noté que vous ne pourrez pas être des nôtres. Nous le regrettons et espérons vous croiser à une prochaine occasion.',
      tone: 'info',
    });
  } catch (err) {
    return htmlPage({
      title: 'Erreur',
      heading: 'Une erreur est survenue',
      message: err instanceof Error ? err.message : 'Erreur inconnue',
      tone: 'error',
    });
  }
}
