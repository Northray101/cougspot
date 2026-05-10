import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CLOAK_API   = 'https://api.usecloak.org/v1/chat'
const CLOAK_MODEL = 'pneuma'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { model = CLOAK_MODEL, messages } = await req.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      })
    }

    const res = await fetch(CLOAK_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages }),
    })

    const data = await res.json()

    if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))

    const text: string = data.response ?? 'No response received.'

    return new Response(JSON.stringify({ response: text }), {
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }
})
