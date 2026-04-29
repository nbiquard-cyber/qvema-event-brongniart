export const config = { runtime: 'edge' };

const RESEND_TEMPLATE_ID_ENV = 'RESEND_TEMPLATE_ID';

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

function rsvpUrl(siteUrl: string, guestId: string, response: 'oui' | 'non', token: string): string {
  return `${siteUrl}/api/rsvp?guest=${encodeURIComponent(guestId)}&response=${response}&token=${token}`;
}

async function fetchGuests(): Promise<Array<Record<string, unknown>>> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SECRET_KEY!;
  const res = await fetch(`${url}/rest/v1/guests?select=*&order=created_at.asc`, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) throw new Error('Supabase fetch failed: ' + (await res.text()));
  return res.json();
}

async function markInvitationSent(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SECRET_KEY!;
  const filter = ids.map((id) => `"${id}"`).join(',');
  await fetch(`${url}/rest/v1/guests?id=in.(${filter})`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      invitation_sent: true,
      invitation_sent_at: new Date().toISOString(),
    }),
  });
}

interface SendItem {
  guestId: string;
  email: string;
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
}

async function sendOne(opts: {
  apiKey: string;
  from: string;
  templateId: string;
  to: string;
  variables: Record<string, string>;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      template: {
        id: opts.templateId,
        variables: opts.variables,
      },
    }),
  });
  if (!res.ok) return { ok: false, error: await res.text() };
  return { ok: true };
}

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM;
    const templateId = process.env[RESEND_TEMPLATE_ID_ENV];
    const siteUrl = process.env.SITE_URL;
    const secret = process.env.RSVP_SECRET;

    if (!apiKey || !from || !templateId || !siteUrl || !secret) {
      return new Response(
        JSON.stringify({
          error:
            'Missing env: ' +
            ['RESEND_API_KEY', 'RESEND_FROM', RESEND_TEMPLATE_ID_ENV, 'SITE_URL', 'RSVP_SECRET']
              .filter((k) => !process.env[k])
              .join(', '),
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      target?: 'all' | 'not-sent' | 'pending';
      guestIds?: string[];
    };
    const target = body.target ?? 'not-sent';

    const all = await fetchGuests();
    let candidates = all.filter((g) => typeof g.email === 'string' && (g.email as string).includes('@'));
    if (Array.isArray(body.guestIds) && body.guestIds.length > 0) {
      const set = new Set(body.guestIds);
      candidates = candidates.filter((g) => set.has(g.id as string));
    } else if (target === 'not-sent') {
      candidates = candidates.filter((g) => !g.invitation_sent);
    } else if (target === 'pending') {
      candidates = candidates.filter(
        (g) => g.rsvp === 'en attente' || g.rsvp === 'relancer' || !g.rsvp
      );
    }

    const results: SendItem[] = [];
    const successIds: string[] = [];
    for (const g of candidates) {
      const guestId = g.id as string;
      const email = g.email as string;
      const firstName = ((g.first_name as string) ?? '').trim();
      const lastName = ((g.last_name as string) ?? '').trim();

      const yesToken = await hmac(secret, `${guestId}:oui`);
      const noToken = await hmac(secret, `${guestId}:non`);
      const yesUrl = rsvpUrl(siteUrl, guestId, 'oui', yesToken);
      const noUrl = rsvpUrl(siteUrl, guestId, 'non', noToken);

      const guestName = firstName
        ? lastName
          ? `${firstName} ${lastName}`
          : firstName
        : 'Madame, Monsieur';

      const out = await sendOne({
        apiKey,
        from,
        templateId,
        to: email,
        variables: {
          GUEST_NAME: guestName,
          RSVP_YES_URL: yesUrl,
          RSVP_NO_URL: noUrl,
        },
      });
      if (out.ok) {
        results.push({ guestId, email, status: 'sent' });
        successIds.push(guestId);
      } else {
        results.push({ guestId, email, status: 'failed', error: out.error });
      }
    }

    await markInvitationSent(successIds);

    return new Response(
      JSON.stringify({
        sent: successIds.length,
        failed: results.filter((r) => r.status === 'failed').length,
        total: candidates.length,
        results,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'unknown' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
