export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const firstName = url.searchParams.get('firstName') || 'Prénom';

  const baseUrl = `${url.protocol}//${url.host}`;
  const tplRes = await fetch(`${baseUrl}/email-template.html`);
  if (!tplRes.ok) {
    return new Response('Template non trouvé', { status: 502 });
  }
  let html = await tplRes.text();

  // Fill AC merge tags with placeholders for preview
  html = html
    .replace(/%FIRSTNAME%/g, firstName)
    .replace(/%RSVP_GUEST_ID%/g, 'preview-guest-id')
    .replace(/%RSVP_YES_TOKEN%/g, 'preview-yes-token')
    .replace(/%RSVP_NO_TOKEN%/g, 'preview-no-token');

  // Inject print-friendly CSS so PDF export keeps the dark background and
  // splits naturally over 2 pages if needed
  const printCss = `
<style>
  @page { size: A4; margin: 8mm; }
  @media print {
    html, body { background-color: #0b0d10 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body > table { box-shadow: none !important; }
    a { text-decoration: none !important; }
  }
  .preview-banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #d4af37; color: #0b0d10; text-align: center;
    padding: 8px 12px; font-family: -apple-system,sans-serif;
    font-size: 13px; font-weight: 700; letter-spacing: .3px;
  }
  @media print { .preview-banner { display: none !important; } }
  body { padding-top: 40px !important; }
  @media print { body { padding-top: 0 !important; } }
</style>`;
  html = html.replace('</head>', printCss + '\n</head>');

  const banner = `
<div class="preview-banner">APERÇU IMPRESSION — utilisez ⌘P (ou Ctrl+P) → Enregistrer au format PDF</div>`;
  html = html.replace('<body', banner + '\n<body');

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
