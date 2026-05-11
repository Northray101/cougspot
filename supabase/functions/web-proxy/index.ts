import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROXY_BASE = 'https://dqcyecscdelfikbimnpw.supabase.co/functions/v1/web-proxy'

const STRIP_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'x-xss-protection',
  'strict-transport-security',
  'content-encoding',
  'transfer-encoding',
  'content-length',
])

function resolveUrl(rel: string, base: string): string {
  if (!rel) return ''
  if (/^(data:|javascript:|blob:|mailto:|tel:|#)/.test(rel)) return rel
  try { return new URL(rel, base).href } catch { return rel }
}

function proxyUrl(url: string, base: string): string {
  if (!url || /^(#|javascript:|data:|blob:|mailto:|tel:)/.test(url)) return url
  const abs = resolveUrl(url, base)
  if (!/^https?:\/\//.test(abs)) return url
  return `${PROXY_BASE}?url=${encodeURIComponent(abs)}`
}

function rewriteHtml(html: string, base: string): string {
  // Remove existing base tags so they don't interfere with our rewriting
  html = html.replace(/<base\b[^>]*>/gi, '')
  // Strip CSP meta tags that would block our injected script
  html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '')

  // href attributes — skip anchors, javascript:, mailto:, tel:
  html = html.replace(/\bhref="([^"]*)"/gi, (m, u) =>
    (!u || /^(#|javascript:|mailto:|tel:)/.test(u)) ? m : `href="${proxyUrl(u, base)}"`)
  html = html.replace(/\bhref='([^']*)'/gi, (m, u) =>
    (!u || /^(#|javascript:|mailto:|tel:)/.test(u)) ? m : `href='${proxyUrl(u, base)}'`)

  // src attributes
  html = html.replace(/\bsrc="([^"]*)"/gi, (m, u) =>
    (!u || /^(data:|blob:)/.test(u)) ? m : `src="${proxyUrl(u, base)}"`)
  html = html.replace(/\bsrc='([^']*)'/gi, (m, u) =>
    (!u || /^(data:|blob:)/.test(u)) ? m : `src='${proxyUrl(u, base)}'`)

  // action attributes (forms)
  html = html.replace(/\baction="([^"]*)"/gi, (_, u) => u ? `action="${proxyUrl(u, base)}"` : _)

  // srcset attributes
  html = html.replace(/\bsrcset="([^"]*)"/gi, (_, s: string) => {
    const parts = s.split(',').map((part: string) => {
      const trimmed = part.trim()
      const match = trimmed.match(/^(\S+)(.*)$/)
      if (!match) return trimmed
      return proxyUrl(match[1], base) + match[2]
    })
    return `srcset="${parts.join(', ')}"`
  })

  // Inline style url()
  html = html.replace(/\bstyle="([^"]*)"/gi, (_, css: string) =>
    `style="${rewriteCss(css, base)}"`)

  // Inject postMessage reporter: tells the parent frame our current URL and page title
  const script = `<script>(function(){try{var p=new URLSearchParams(location.search),u=p.get('url');if(u&&parent!==window){parent.postMessage({type:'proxy-nav',url:u},'*');var mo=new MutationObserver(function(){if(document.title)parent.postMessage({type:'proxy-title',title:document.title},'*')});mo.observe(document.documentElement,{subtree:true,characterData:true,childList:true})}}catch(e){}})()</script>`

  if (html.includes('</head>')) return html.replace('</head>', script + '</head>')
  if (/<body[\s>]/i.test(html)) return html.replace(/<body[\s>]/i, (m) => script + m)
  return script + html
}

function rewriteCss(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) =>
    u.startsWith('data:') ? m : `url(${q}${proxyUrl(u, base)}${q})`)
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { searchParams } = new URL(req.url)
  const target = searchParams.get('url')
  if (!target) return new Response('url required', { status: 400, headers: CORS })

  // Validate URL and block private/internal addresses
  let _parsed: URL
  try {
    _parsed = new URL(target)
    if (!['http:', 'https:'].includes(_parsed.protocol)) throw new Error('bad protocol')
    const h = _parsed.hostname.toLowerCase()
    if (/^(localhost|127\.\d+|::1|0\.0\.0\.0|192\.168\.|10\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) {
      return new Response('Blocked: private address', { status: 403, headers: CORS })
    }
  } catch {
    return new Response('Invalid URL', { status: 400, headers: CORS })
  }

  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    })

    const ct = (res.headers.get('content-type') || '').toLowerCase()
    const finalUrl = res.url || target

    const outHeaders: Record<string, string> = { ...CORS }
    for (const [k, v] of res.headers.entries()) {
      if (!STRIP_HEADERS.has(k.toLowerCase())) outHeaders[k] = v
    }
    outHeaders['content-type'] = ct || 'application/octet-stream'

    if (ct.includes('text/html')) {
      return new Response(rewriteHtml(await res.text(), finalUrl), { headers: outHeaders })
    }
    if (ct.includes('text/css')) {
      return new Response(rewriteCss(await res.text(), finalUrl), { headers: outHeaders })
    }
    // Pass through binary and other content (images, fonts, JS, etc.)
    return new Response(res.body, { status: res.status, headers: outHeaders })

  } catch (e) {
    return new Response(`Proxy error: ${e}`, {
      status: 502,
      headers: { ...CORS, 'content-type': 'text/plain' },
    })
  }
})
