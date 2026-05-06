export const config = { runtime: 'nodejs', maxDuration: 300 };

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
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error('Supabase fetch failed: ' + (await res.text()));
  return res.json();
}

async function acRequest(
  acUrl: string,
  acKey: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${acUrl}${path}`, {
    ...init,
    headers: {
      'Api-Token': acKey,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

interface SyncResult {
  guestId: string;
  email: string;
  status: 'synced' | 'skipped' | 'failed';
  error?: string;
}

const TAG_PREFIX = 'Brongniart - ';

async function loadAcTags(acUrl: string, acKey: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let offset = 0;
  while (true) {
    const res = await acRequest(acUrl, acKey, `/api/3/tags?limit=100&offset=${offset}`);
    if (!res.ok) break;
    const data = (await res.json()) as { tags?: Array<{ id: string; tag: string }> };
    const tags = data.tags ?? [];
    for (const t of tags) map.set(t.tag, t.id);
    if (tags.length < 100) break;
    offset += 100;
  }
  return map;
}

async function ensureTag(
  acUrl: string,
  acKey: string,
  cache: Map<string, string>,
  tagName: string
): Promise<string | null> {
  const cached = cache.get(tagName);
  if (cached) return cached;
  const res = await acRequest(acUrl, acKey, '/api/3/tags', {
    method: 'POST',
    body: JSON.stringify({
      tag: { tag: tagName, tagType: 'contact', description: 'Auto - Brongniart sync' },
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { tag?: { id?: string } };
  const id = data.tag?.id ?? null;
  if (id) cache.set(tagName, id);
  return id;
}

async function attachTag(
  acUrl: string,
  acKey: string,
  contactId: string,
  tagId: string
): Promise<void> {
  await acRequest(acUrl, acKey, '/api/3/contactTags', {
    method: 'POST',
    body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } }),
  });
}

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    const acUrl = process.env.AC_API_URL;
    const acKey = process.env.AC_API_KEY;
    const acListId = process.env.AC_LIST_ID;
    const fieldYes = process.env.AC_FIELD_RSVP_YES;
    const fieldNo = process.env.AC_FIELD_RSVP_NO;
    const fieldOrg = process.env.AC_FIELD_ORG;
    const siteUrl = process.env.SITE_URL;
    const secret = process.env.RSVP_SECRET;

    const missing = [
      ['AC_API_URL', acUrl],
      ['AC_API_KEY', acKey],
      ['AC_LIST_ID', acListId],
      ['AC_FIELD_RSVP_YES', fieldYes],
      ['AC_FIELD_RSVP_NO', fieldNo],
      ['AC_FIELD_ORG', fieldOrg],
      ['SITE_URL', siteUrl],
      ['RSVP_SECRET', secret],
    ]
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      return new Response(JSON.stringify({ error: `Missing env: ${missing.join(', ')}` }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const all = await fetchGuests();
    const candidates = all.filter(
      (g) => typeof g.email === 'string' && (g.email as string).includes('@')
    );

    const results: SyncResult[] = [];
    const skipped: SyncResult[] = [];
    const tagsCache = await loadAcTags(acUrl!, acKey!);

    for (const g of candidates) {
      const guestId = g.id as string;
      const email = g.email as string;
      const firstName = ((g.first_name as string) ?? '').trim();
      const lastName = ((g.last_name as string) ?? '').trim();
      const phone = ((g.phone as string) ?? '').trim();
      const organization = ((g.organization as string) ?? '').trim();
      const category = ((g.category as string) ?? '').trim();

      try {
        const yesToken = await hmac(secret!, `${guestId}:oui`);
        const noToken = await hmac(secret!, `${guestId}:non`);
        const yesUrl = rsvpUrl(siteUrl!, guestId, 'oui', yesToken);
        const noUrl = rsvpUrl(siteUrl!, guestId, 'non', noToken);

        const syncBody = {
          contact: {
            email,
            firstName,
            lastName,
            phone,
            fieldValues: [
              { field: fieldYes, value: yesUrl },
              { field: fieldNo, value: noUrl },
              { field: fieldOrg, value: organization },
              { field: '5', value: guestId },
              { field: '6', value: yesToken },
              { field: '7', value: noToken },
            ],
          },
        };
        const syncRes = await acRequest(acUrl!, acKey!, '/api/3/contact/sync', {
          method: 'POST',
          body: JSON.stringify(syncBody),
        });
        if (!syncRes.ok) {
          results.push({
            guestId,
            email,
            status: 'failed',
            error: 'sync: ' + (await syncRes.text()),
          });
          continue;
        }
        const syncData = (await syncRes.json()) as { contact?: { id?: string } };
        const contactId = syncData.contact?.id;
        if (!contactId) {
          results.push({ guestId, email, status: 'failed', error: 'no contact id' });
          continue;
        }

        const listRes = await acRequest(acUrl!, acKey!, '/api/3/contactLists', {
          method: 'POST',
          body: JSON.stringify({
            contactList: { list: acListId, contact: contactId, status: 1 },
          }),
        });
        if (!listRes.ok) {
          results.push({
            guestId,
            email,
            status: 'failed',
            error: 'list: ' + (await listRes.text()),
          });
          continue;
        }

        if (category) {
          const tagName = TAG_PREFIX + category;
          const tagId = await ensureTag(acUrl!, acKey!, tagsCache, tagName);
          if (tagId) await attachTag(acUrl!, acKey!, contactId, tagId);
        }

        results.push({ guestId, email, status: 'synced' });
      } catch (err) {
        results.push({
          guestId,
          email,
          status: 'failed',
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    const synced = results.filter((r) => r.status === 'synced').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    return new Response(
      JSON.stringify({
        synced,
        failed,
        skipped: skipped.length,
        total: candidates.length,
        listId: acListId,
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
