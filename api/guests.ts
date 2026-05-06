export const config = { runtime: 'edge' };

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

const AIRTABLE_VALID_CATEGORIES = new Set([
  'VIP', 'Investisseur', 'Candidat', 'Entrepreneurs QVEMA',
  'Ambassadeurs', 'Jury',
  'Presse', 'Partenaire', 'Équipe', 'Autre',
]);

function airtableFields(g: Record<string, unknown>): Record<string, unknown> {
  const first = ((g.first_name as string) ?? '').trim();
  const last = ((g.last_name as string) ?? '').trim();
  const cat = ((g.category as string) ?? '').trim();
  const out: Record<string, unknown> = {
    'Nom complet': `${first} ${last}`.trim(),
    'Prénom': first,
    'NOM': last,
    'Mail': ((g.email as string) ?? '').trim(),
    'Téléphone': ((g.phone as string) ?? '').trim(),
    'Entreprise': ((g.organization as string) ?? '').trim(),
    'RSVP': ((g.rsvp as string) ?? 'en attente').trim(),
  };
  if (AIRTABLE_VALID_CATEGORIES.has(cat)) out['Catégorie'] = cat;
  return out;
}

async function airtableFindIdByEmail(email: string): Promise<string | null> {
  const pat = process.env.AIRTABLE_PAT;
  const base = process.env.AIRTABLE_BASE;
  const table = process.env.AIRTABLE_TABLE;
  if (!pat || !base || !table || !email) return null;
  const escaped = email.replace(/'/g, "\\'").toLowerCase();
  const filter = encodeURIComponent(`LOWER({Mail}) = '${escaped}'`);
  const res = await fetch(
    `https://api.airtable.com/v0/${base}/${table}?filterByFormula=${filter}&maxRecords=1`,
    { headers: { Authorization: `Bearer ${pat}` } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { records?: Array<{ id: string }> };
  return data.records?.[0]?.id ?? null;
}

async function airtableUpsert(g: Record<string, unknown>): Promise<void> {
  const pat = process.env.AIRTABLE_PAT;
  const base = process.env.AIRTABLE_BASE;
  const table = process.env.AIRTABLE_TABLE;
  const email = ((g.email as string) ?? '').trim();
  if (!pat || !base || !table || !email) return;
  try {
    const fields = airtableFields(g);
    const recId = await airtableFindIdByEmail(email);
    if (recId) {
      await fetch(`https://api.airtable.com/v0/${base}/${table}/${recId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${pat}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
    } else {
      await fetch(`https://api.airtable.com/v0/${base}/${table}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pat}`, 'content-type': 'application/json' },
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
      });
    }
  } catch {
    // best-effort mirror
  }
}

async function airtableDeleteByEmail(email: string): Promise<void> {
  const pat = process.env.AIRTABLE_PAT;
  const base = process.env.AIRTABLE_BASE;
  const table = process.env.AIRTABLE_TABLE;
  if (!pat || !base || !table || !email) return;
  try {
    const recId = await airtableFindIdByEmail(email);
    if (!recId) return;
    await fetch(`https://api.airtable.com/v0/${base}/${table}/${recId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${pat}` },
    });
  } catch {
    // best-effort
  }
}

export default async function handler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (url.searchParams.get('debug') === '1') {
      return jsonResponse({
        ok: true,
        method: request.method,
        hasUrl: Boolean(process.env.SUPABASE_URL),
        hasKey: Boolean(process.env.SUPABASE_SECRET_KEY),
      });
    }

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
      await Promise.all(rows.map((r) => airtableUpsert(r)));
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
      await airtableUpsert(rows[0]);
      return jsonResponse(fromDb(rows[0]));
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const lookup = await supabase(`/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}&select=email`);
      let emailToDelete = '';
      if (lookup.ok) {
        const found = (await lookup.json()) as Array<{ email?: string }>;
        emailToDelete = (found[0]?.email ?? '').trim();
      }
      const res = await supabase(`/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) return jsonResponse({ error: await res.text() }, 502);
      if (emailToDelete) await airtableDeleteByEmail(emailToDelete);
      return new Response(null, { status: 204 });
    }

    return jsonResponse({ error: 'method not allowed' }, 405);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'unknown' }, 500);
  }
}
