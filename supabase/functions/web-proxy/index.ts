import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROXY_ORIGIN = 'https://dqcyecscdelfikbimnpw.supabase.co/functions/v1/web-proxy'

// Headers we never forward from the proxied site to the browser
const STRIP_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'x-xss-protection',
  'strict-transport-security',
  'content-encoding',  // Deno decompresses automatically; forwarding this confuses browsers
  'transfer-encoding',
  'content-length',    // body changes size after rewriting
  'content-type',      // we set this ourselves
])

function resolveUrl(rel: string, base: string): string {
  if (!rel) return ''
  if (/^(data:|javascript:|blob:|mailto:|tel:|#)/.test(rel)) return rel
  try { return new URL(rel, base).href } catch { return rel }
}

function makeProxyUrl(url: string, base: string, proxyBase: string): string {
  if (!url || /^(#|javascript:|data:|blob:|mailto:|tel:)/.test(url)) return url
  const abs = resolveUrl(url, base)
  if (!/^https?:\/\//.test(abs)) return url
  return proxyBase + encodeURIComponent(abs)
}

function rewriteHtml(html: string, base: string, proxyBase: string): string {
  // Strip existing base and CSP meta tags
  html = html.replace(/<base\b[^>]*>/gi, '')
  html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '')

  const px = (url: string) => makeProxyUrl(url, base, proxyBase)

  // href — skip anchors, javascript:, mailto:, tel:
  html = html.replace(/\bhref="([^"]*)"/gi, (m, u) =>
    (!u || /^(#|javascript:|mailto:|tel:)/.test(u)) ? m : `href="${px(u)}"`)
  html = html.replace(/\bhref='([^']*)'/gi, (m, u) =>
    (!u || /^(#|javascript:|mailto:|tel:)/.test(u)) ? m : `href='${px(u)}'`)

  // src
  html = html.replace(/\bsrc="([^"]*)"/gi, (m, u) =>
    (!u || /^(data:|blob:)/.test(u)) ? m : `src="${px(u)}"`)
  html = html.replace(/\bsrc='([^']*)'/gi, (m, u) =>
    (!u || /^(data:|blob:)/.test(u)) ? m : `src='${px(u)}'`)

  // action (forms)
  html = html.replace(/\baction="([^"]*)"/gi, (_, u) => u ? `action="${px(u)}"` : _)

  // srcset
  html = html.replace(/\bsrcset="([^"]*)"/gi, (_, s: string) => {
    const parts = s.split(',').map((part: string) => {
      const trimmed = part.trim()
      const match = trimmed.match(/^(\S+)(.*)$/)
      if (!match) return trimmed
      return px(match[1]) + match[2]
    })
    return `srcset="${parts.join(', ')}"`
  })

  // Inline style url()
  html = html.replace(/\bstyle="([^"]*)"/gi, (_, css: string) =>
    `style="${rewriteCss(css, base, proxyBase)}"`)

  // Inject navigation reporter + link-click interceptor.
  // BASE is embedded directly because when loaded via srcdoc, location.search has no ?url= param.
  const escapedBase = JSON.stringify(base)
  const script = `<script>(function(){try{
var BASE=${escapedBase};
if(parent!==window){
  parent.postMessage({type:'proxy-nav',url:BASE},'*');
  var mo=new MutationObserver(function(){
    if(document.title)parent.postMessage({type:'proxy-title',title:document.title},'*');
  });
  mo.observe(document.documentElement,{subtree:true,characterData:true,childList:true});
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href]');
    if(!a)return;
    try{
      var pu=new URL(a.href),ou=pu.searchParams.get('url');
      if(ou){e.preventDefault();e.stopPropagation();parent.postMessage({type:'proxy-click',url:ou},'*');}
    }catch(x){}
  },true);
}
}catch(e){}})()</script>`

  if (html.includes('</head>')) return html.replace('</head>', script + '</head>')
  if (/<body[\s>]/i.test(html)) return html.replace(/<body[\s>]/i, (m) => script + m)
  return script + html
}

function rewriteCss(css: string, base: string, proxyBase: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) =>
    u.startsWith('data:') ? m : `url(${q}${makeProxyUrl(u, base, proxyBase)}${q})`)
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const { searchParams } = new URL(req.url)
  const target = searchParams.get('url')
  const apikey = searchParams.get('apikey') || req.headers.get('apikey') || ''

  if (!target) return new Response('url required', { status: 400, headers: CORS })

  // Build proxy base that propagates the apikey into every rewritten URL
  const proxyBase = apikey
    ? `${PROXY_ORIGIN}?apikey=${encodeURIComponent(apikey)}&url=`
    : `${PROXY_ORIGIN}?url=`

  // Validate and block private/internal addresses
  try {
    const p = new URL(target)
    if (!['http:', 'https:'].includes(p.protocol)) throw new Error('bad protocol')
    const h = p.hostname.toLowerCase()
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

    // Build clean response headers — use Headers object to avoid case-duplicate keys
    const outHeaders = new Headers()
    for (const [k, v] of Object.entries(CORS)) outHeaders.set(k, v)
    for (const [k, v] of res.headers.entries()) {
      if (!STRIP_HEADERS.has(k.toLowerCase())) outHeaders.set(k, v)
    }

    if (ct.includes('text/html')) {
      outHeaders.set('content-type', 'text/html; charset=utf-8')
      return new Response(rewriteHtml(await res.text(), finalUrl, proxyBase), { headers: outHeaders })
    }
    if (ct.includes('text/css')) {
      outHeaders.set('content-type', ct)
      return new Response(rewriteCss(await res.text(), finalUrl, proxyBase), { headers: outHeaders })
    }
    outHeaders.set('content-type', ct || 'application/octet-stream')
    return new Response(res.body, { status: res.status, headers: outHeaders })

  } catch (e) {
    return new Response(`Proxy error: ${e}`, {
      status: 502,
      headers: { ...CORS, 'content-type': 'text/plain' },
    })
  }
})
