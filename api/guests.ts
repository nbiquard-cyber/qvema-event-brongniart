const SUPABASE_TABLE = 'guests';

const FIELD_MAP: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  organization: 'organization',
  plusOne: 'plus_one',
  plusOneName: 'plus_one_name',
  invitationSent: 'invitation_sent',
  invitationSentAt: 'invitation_sent_at',
  checkedIn: 'checked_in',
  checkedInAt: 'checked_in_at',
};

const REVERSE_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([k, v]) => [v, k])
);

function toDb(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[FIELD_MAP[k] ?? k] = v === '' ? null : v;
  }
  return out;
}

function fromDb(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[REVERSE_FIELD_MAP[k] ?? k] = v ?? '';
  }
  return out;
}

async function supabase(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars not configured');
  }
  return fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const res = await supabase(`/${SUPABASE_TABLE}?select=*&order=created_at.asc`);
      if (!res.ok) return jsonResponse({ error: await res.text() }, 502);
      const rows = (await res.json()) as Record<string, unknown>[];
      return jsonResponse(rows.map(fromDb));
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const items = Array.isArray(body) ? body : [body];
      const payload = items.map((g) => toDb(g));
      const res = await supabase(`/${SUPABASE_TABLE}`, {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return jsonResponse({ error: await res.text() }, 502);
      const rows = (await res.json()) as Record<string, unknown>[];
      return jsonResponse(rows.map(fromDb), 201);
    }

    if (request.method === 'PATCH' || request.method === 'PUT') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const body = await request.json();
      const payload = toDb(body);
      delete payload.id;
      delete payload.created_at;
      const res = await supabase(`/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return jsonResponse({ error: await res.text() }, 502);
      const rows = (await res.json()) as Record<string, unknown>[];
      if (rows.length === 0) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse(fromDb(rows[0]));
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const res = await supabase(`/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) return jsonResponse({ error: await res.text() }, 502);
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ error: 'method not allowed' }, 405);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'unknown' }, 500);
  }
}
