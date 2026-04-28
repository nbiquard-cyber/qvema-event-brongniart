export const config = {
  matcher: '/((?!_vercel|favicon\\.ico).*)',
};

const COOKIE_NAME = 'qvema_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export default async function middleware(request: Request): Promise<Response | undefined> {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return new Response('SITE_PASSWORD not configured', { status: 500 });
  }

  const expectedToken = await sha256(password);
  const url = new URL(request.url);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const isAuthed = cookieHeader
    .split(';')
    .some((c) => c.trim() === `${COOKIE_NAME}=${expectedToken}`);

  if (url.pathname === '/login' && request.method === 'POST') {
    const form = await request.formData();
    const submitted = form.get('password');
    if (typeof submitted === 'string' && submitted === password) {
      return new Response(null, {
        status: 303,
        headers: {
          location: '/',
          'set-cookie': `${COOKIE_NAME}=${expectedToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
        },
      });
    }
    return new Response(renderLogin('Mot de passe incorrect.'), {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  if (!isAuthed) {
    return new Response(renderLogin(), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return undefined;
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function renderLogin(error?: string): string {
  const errorBlock = error ? `<div class="err">${error}</div>` : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QVEMA Amplify Event — Accès</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0b0d10;
    color: #fff;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #14171b;
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 16px;
    padding: 40px 32px;
    width: 100%;
    max-width: 380px;
    box-shadow: 0 20px 60px rgba(0,0,0,.4);
  }
  h1 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 4px;
    letter-spacing: -0.01em;
  }
  .sub {
    color: rgba(255,255,255,.5);
    font-size: 13px;
    margin-bottom: 28px;
  }
  label {
    display: block;
    font-size: 11px;
    color: rgba(255,255,255,.6);
    margin-bottom: 8px;
    letter-spacing: 1px;
    text-transform: uppercase;
  }
  input[type=password] {
    width: 100%;
    background: #0b0d10;
    border: 1px solid rgba(255,255,255,.12);
    color: #fff;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 15px;
    outline: none;
    transition: border-color .15s;
    font-family: inherit;
  }
  input[type=password]:focus { border-color: #d4af37; }
  button {
    margin-top: 16px;
    width: 100%;
    background: linear-gradient(135deg, #d4af37 0%, #b8932d 100%);
    color: #0b0d10;
    border: 0;
    border-radius: 10px;
    padding: 12px;
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
    letter-spacing: 0.2px;
    font-family: inherit;
  }
  button:hover { filter: brightness(1.05); }
  .err {
    background: rgba(220,60,60,.1);
    border: 1px solid rgba(220,60,60,.3);
    color: #ff7b7b;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 13px;
    margin-bottom: 16px;
  }
</style>
</head>
<body>
  <form class="card" method="POST" action="/login">
    <h1>QVEMA Amplify Event</h1>
    <div class="sub">Accès restreint</div>
    ${errorBlock}
    <label for="pw">Mot de passe</label>
    <input id="pw" type="password" name="password" autofocus required>
    <button type="submit">Entrer</button>
  </form>
</body>
</html>`;
}
