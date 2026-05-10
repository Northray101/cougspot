import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { message, chat_history = [], system_prompt } = await req.json()

    if (!message) {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      })
    }

    const messages = [
      ...chat_history.map((m: { role: string; message: string }) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.message,
      })),
      { role: 'user', content: message },
    ]

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: system_prompt ?? 'You are a helpful assistant for Norco High School students.',
        messages,
      }),
    })

    const data = await res.json()

    if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error))

    const text: string = data.content?.[0]?.text ?? 'No response received.'

    return new Response(JSON.stringify({ text }), {
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
