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

function htmlPage(opts: { title: string; heading: string; message: string; tone: 'success' | 'error' | 'info' }): Response {
  const accent = opts.tone === 'success' ? '#10b981' : opts.tone === 'error' ? '#ef4444' : '#d4af37';
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
  .brand { margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,.08); }
  .brand img { max-width: 140px; opacity: .8; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${opts.tone === 'success' ? '✓' : opts.tone === 'error' ? '!' : 'ℹ'}</div>
    <h1>${opts.heading}</h1>
    <p>${opts.message}</p>
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
        message: 'Votre présence est confirmée pour la soirée de lancement QVEMA Amplify, jeudi 4 juin 2026 au Palais Brongniart. Vous recevrez prochainement le programme détaillé.',
        tone: 'success',
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
