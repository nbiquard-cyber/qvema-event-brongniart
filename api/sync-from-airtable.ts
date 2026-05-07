export const config = { runtime: 'edge' };

const VALID_CATEGORIES = new Set([
  'VIP', 'Investisseur', 'Candidat', 'Entrepreneurs QVEMA',
  'Coach QVEMA Amplify', 'Expert QVEMA Amplify',
  'Ambassadeurs', 'Jury', 'Presse', 'Partenaire', 'Équipe', 'Guest', 'Autre',
]);

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

async function fetchAirtableRecords(): Promise<AirtableRecord[]> {
  const pat = process.env.AIRTABLE_PAT!;
  const base = process.env.AIRTABLE_BASE!;
  const table = process.env.AIRTABLE_TABLE!;
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  for (let i = 0; i < 100; i++) {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (offset) qs.set('offset', offset);
    const res = await fetch(
      `https://api.airtable.com/v0/${base}/${table}?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${pat}` } }
    );
    if (!res.ok) throw new Error(`Airtable: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
    if (!offset) break;
  }
  return records;
}

async function fetchSupabaseGuests(): Promise<Array<Record<string, unknown>>> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SECRET_KEY!;
  const res = await fetch(`${url}/rest/v1/guests?select=*&limit=10000`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase fetch: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supabaseRequest(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SECRET_KEY!;
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

function clean(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function airtableToGuest(f: Record<string, unknown>): Record<string, unknown> | null {
  const email = clean(f['Mail']).toLowerCase();
  if (!email || !email.includes('@')) return null;
  const cat = clean(f['Catégorie']);
  return {
    first_name: clean(f['Prénom']),
    last_name: clean(f['NOM']),
    email,
    phone: clean(f['Téléphone']),
    organization: clean(f['Entreprise']),
    category: VALID_CATEGORIES.has(cat) ? cat : (cat || 'Entrepreneurs QVEMA'),
    notes: clean(f['Notes']),
  };
}

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    const [airtable, supabase] = await Promise.all([
      fetchAirtableRecords(),
      fetchSupabaseGuests(),
    ]);

    const sbByEmail = new Map<string, Record<string, unknown>>();
    for (const g of supabase) {
      const e = clean(g.email).toLowerCase();
      if (e) sbByEmail.set(e, g);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const r of airtable) {
      const guest = airtableToGuest(r.fields);
      if (!guest) { skipped++; continue; }
      const email = guest.email as string;
      const existing = sbByEmail.get(email);

      try {
        if (!existing) {
          const res = await supabaseRequest('/guests', {
            method: 'POST',
            headers: { prefer: 'return=minimal' },
            body: JSON.stringify({
              ...guest,
              rsvp: 'en attente',
              plus_one: false,
              ac_synced: false,
            }),
          });
          if (!res.ok) throw new Error('insert: ' + (await res.text()));
          created++;
        } else {
          // Only patch if any tracked field actually differs
          const fields: Array<keyof typeof guest> = [
            'first_name','last_name','phone','organization','category','notes'
          ];
          const diff: Record<string, unknown> = {};
          for (const f of fields) {
            const incoming = (guest as Record<string, unknown>)[f] ?? '';
            const current = (existing[f] as unknown) ?? '';
            if (String(incoming) !== String(current)) diff[f] = incoming;
          }
          if (Object.keys(diff).length === 0) { skipped++; continue; }
          const res = await supabaseRequest(
            `/guests?id=eq.${encodeURIComponent(existing.id as string)}`,
            {
              method: 'PATCH',
              headers: { prefer: 'return=minimal' },
              body: JSON.stringify(diff),
            }
          );
          if (!res.ok) throw new Error('update: ' + (await res.text()));
          updated++;
        }
      } catch (err) {
        failed++;
        errors.push(`${email}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    return new Response(
      JSON.stringify({
        created,
        updated,
        skipped,
        failed,
        errors: errors.slice(0, 5),
        airtableTotal: airtable.length,
        supabaseTotal: supabase.length,
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
