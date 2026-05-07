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
  acSynced: 'ac_synced',
  acSyncedAt: 'ac_synced_at',
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
  'Coach QVEMA Amplify', 'Expert QVEMA Amplify',
  'Ambassadeurs', 'Jury',
  'Presse', 'Partenaire', 'Équipe', 'Guest', 'Autre',
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
    const url = recId
      ? `https://api.airtable.com/v0/${base}/${table}/${recId}`
      : `https://api.airtable.com/v0/${base}/${table}`;
    const body = recId
      ? JSON.stringify({ fields })
      : JSON.stringify({ records: [{ fields }], typecast: true });
    const res = await fetch(url, {
      method: recId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${pat}`, 'content-type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[airtableUpsert] HTTP', res.status, 'for', email, '-', text.slice(0, 300));
    }
  } catch (err) {
    console.error('[airtableUpsert] threw for', email, ':', err);
  }
}

async function acFindContactIdByEmail(email: string): Promise<string | null> {
  const acUrl = process.env.AC_API_URL;
  const acKey = process.env.AC_API_KEY;
  if (!acUrl || !acKey || !email) return null;
  const res = await fetch(`${acUrl}/api/3/contacts?email=${encodeURIComponent(email)}`, {
    headers: { 'Api-Token': acKey },
  });
  if (!res.ok) return null;
  const d = (await res.json()) as { contacts?: Array<{ id: string }> };
  return d.contacts?.[0]?.id ?? null;
}

async function acReplaceCategoryTag(email: string, newCategory: string): Promise<void> {
  const acUrl = process.env.AC_API_URL;
  const acKey = process.env.AC_API_KEY;
  if (!acUrl || !acKey || !email || !newCategory) return;
  try {
    const contactId = await acFindContactIdByEmail(email);
    if (!contactId) return;
    // List current contactTags
    const ctRes = await fetch(`${acUrl}/api/3/contacts/${contactId}/contactTags`, {
      headers: { 'Api-Token': acKey },
    });
    if (!ctRes.ok) return;
    const ctData = (await ctRes.json()) as {
      contactTags?: Array<{ id: string; tag: string }>;
    };
    // Get tag name lookup
    const tagsRes = await fetch(`${acUrl}/api/3/tags?limit=200`, {
      headers: { 'Api-Token': acKey },
    });
    if (!tagsRes.ok) return;
    const tagsData = (await tagsRes.json()) as {
      tags?: Array<{ id: string; tag: string }>;
    };
    const tagsByName = new Map<string, string>();
    const tagsById = new Map<string, string>();
    for (const t of tagsData.tags ?? []) {
      tagsByName.set(t.tag, t.id);
      tagsById.set(t.id, t.tag);
    }
    const desiredTagName = `Brongniart - ${newCategory}`;
    // Delete every Brongniart-* contactTag that isn't the desired one
    for (const ct of ctData.contactTags ?? []) {
      const name = tagsById.get(ct.tag) ?? '';
      if (name.startsWith('Brongniart - ') && name !== desiredTagName) {
        await fetch(`${acUrl}/api/3/contactTags/${ct.id}`, {
          method: 'DELETE',
          headers: { 'Api-Token': acKey },
        });
      }
    }
    // Ensure desired tag exists + attached
    let desiredId = tagsByName.get(desiredTagName);
    if (!desiredId) {
      const cRes = await fetch(`${acUrl}/api/3/tags`, {
        method: 'POST',
        headers: { 'Api-Token': acKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          tag: { tag: desiredTagName, tagType: 'contact', description: 'Auto - Brongniart' },
        }),
      });
      if (cRes.ok) {
        const cData = (await cRes.json()) as { tag?: { id?: string } };
        desiredId = cData.tag?.id;
      }
    }
    if (!desiredId) return;
    const alreadyHas = (ctData.contactTags ?? []).some((ct) => ct.tag === desiredId);
    if (!alreadyHas) {
      await fetch(`${acUrl}/api/3/contactTags`, {
        method: 'POST',
        headers: { 'Api-Token': acKey, 'content-type': 'application/json' },
        body: JSON.stringify({ contactTag: { contact: contactId, tag: desiredId } }),
      });
    }
  } catch (err) {
    console.error('[acReplaceCategoryTag]', email, err);
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
      const categoryChanged = Object.prototype.hasOwnProperty.call(body, 'category');
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
      if (categoryChanged) {
        const updatedEmail = ((rows[0].email as string) ?? '').trim();
        const updatedCategory = ((rows[0].category as string) ?? '').trim();
        if (updatedEmail && updatedCategory) {
          await acReplaceCategoryTag(updatedEmail, updatedCategory);
        }
      }
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
