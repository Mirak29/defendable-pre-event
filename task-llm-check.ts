// `deno task llm:check`: one small call per model of the routes, to check the
// keys and the endpoints (build.nvidia.com, a Brev NIM through
// NVIDIA_NANO_BASE_URL, Google AI Studio). Prints the model, the latency and
// the answer, never a key.
import { hasAiKey, llmConfig, MODELS } from '/api/llm.ts'

if (!hasAiKey()) {
  console.error('Ni NVIDIA_API_KEY ni GEMINI_API_KEY : ajoutez-les dans .env')
  Deno.exit(1)
}

let failed = false
for (const [id, e] of Object.entries(MODELS)) {
  const key = llmConfig.keys[e.provider]
  if (!key) {
    console.log(`·  ${id} · ${e.model} · pas de clé ${e.provider}`)
    continue
  }
  const started = performance.now()
  try {
    const res = await fetch(`${e.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: e.model,
        messages: [{
          role: 'user',
          content: 'Réponds uniquement avec ce JSON : {"ok":true}',
        }],
        max_tokens: e.reasoning ? 2000 : 50,
        temperature: 0,
        ...(e.reasoning && { reasoning_effort: e.reasoning }),
        ...(e.model.startsWith('nvidia/') &&
          { chat_template_kwargs: { enable_thinking: false } }),
      }),
    })
    const ms = Math.round(performance.now() - started)
    const text = await res.text()
    if (!res.ok) throw Error(`${res.status} ${text.slice(0, 200)}`)
    const body = JSON.parse(text)
    const answer = body.choices?.[0]?.message?.content ?? ''
    console.log(
      `✅ ${id} · ${e.model} · ${e.where} · ${ms} ms · ${answer.trim()}`,
    )
  } catch (err) {
    failed = true
    console.error(
      `❌ ${id} · ${e.model} · ${e.baseUrl} · ${(err as Error).message}`,
    )
  }
}
Deno.exit(failed ? 1 : 0)
