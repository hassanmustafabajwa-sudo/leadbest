// AI provider abstraction: every provider takes a prompt + JSON schema and
// returns a parsed object. Keys are read from server env only.
//
// Provider chain for all LeadOS AI work:
//   1. Lovable AI (primary)
//   2. Google Gemini Flash-Lite (automatic fallback)
// Gemini is only called when the primary provider fails, is rate limited,
// times out or returns an unusable response.

export type AiProviderId = "lovable" | "openrouter" | "gemini";

export type AiProviderStatus = {
  id: AiProviderId;
  name: string;
  configured: boolean;
  defaultModel: string;
  detail: string;
};

export class AiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly kind:
      | "config"
      | "auth"
      | "rate_limit"
      | "payment"
      | "upstream"
      | "timeout"
      | "invalid_response" = "upstream",
  ) {
    super(message);
    this.name = "AiError";
  }
}

// A JSON-schema object (OpenAI strict-compatible: all fields required, no additionalProperties).
export type JsonSchema = Record<string, unknown>;

export type GenerateJsonArgs = {
  provider: AiProviderId;
  model?: string | null;
  system: string;
  prompt: string;
  schemaName: string;
  schema: JsonSchema;
};

export const PRIMARY_PROVIDER: AiProviderId = "lovable";
export const FALLBACK_PROVIDER: AiProviderId = "gemini";

// "Gemini 3.5 Flash-Lite"; older aliases are tried automatically if the
// configured key/project does not expose the newest id.
const GEMINI_MODEL_CANDIDATES = [
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
];

const GATEWAY_GEMINI_MODEL = "google/gemini-3.1-flash-lite";

const REQUEST_TIMEOUT_MS = 60_000;

const DEFAULTS: Record<AiProviderId, { name: string; model: string; env?: string }> = {
  lovable: { name: "Lovable AI", model: "openai/gpt-6-astra" },
  openrouter: { name: "OpenRouter", model: "openai/gpt-4o-mini", env: "OPENROUTER_API_KEY" },
  gemini: { name: "Google Gemini", model: GEMINI_MODEL_CANDIDATES[0]!, env: "GEMINI_API_KEY" },
};

export function listAiProviders(): AiProviderStatus[] {
  return (Object.keys(DEFAULTS) as AiProviderId[]).map((id) => {
    const d = DEFAULTS[id];
    const ownKey = d.env ? process.env[d.env] : undefined;
    const viaGateway = id === "gemini" && !ownKey && !!process.env["LOVABLE_API_KEY"];
    const key = d.env ? ownKey : process.env["LOVABLE_API_KEY"];
    const configured = !!key || viaGateway;
    const model = id === "gemini" ? (viaGateway ? GATEWAY_GEMINI_MODEL : geminiConfiguredModel()) : d.model;
    return {
      id,
      name: d.name,
      configured,
      defaultModel: model,
      detail: viaGateway
        ? "Runs on the server through Lovable AI. No key needed."
        : configured
        ? d.env
          ? `${d.env} is set.`
          : "Included with Lovable Cloud. No key needed."
        : d.env
          ? `Not configured. Add the ${d.env} secret to this project.`
          : "LOVABLE_API_KEY is missing.",
    };
  });
}

function geminiConfiguredModel(): string {
  return process.env["GEMINI_MODEL"]?.trim() || GEMINI_MODEL_CANDIDATES[0]!;
}

export function isProviderConfigured(id: AiProviderId): boolean {
  return listAiProviders().find((p) => p.id === id)?.configured ?? false;
}

export function defaultModelFor(id: AiProviderId): string {
  return id === "gemini" ? geminiConfiguredModel() : DEFAULTS[id].model;
}

export type AiChainStatus = {
  primary: { id: AiProviderId; name: string; model: string; configured: boolean; detail: string };
  fallback: { id: AiProviderId; name: string; model: string; configured: boolean; detail: string };
};

export function getAiChainStatus(): AiChainStatus {
  const all = listAiProviders();
  const pick = (id: AiProviderId) => {
    const p = all.find((x) => x.id === id)!;
    return { id: p.id, name: p.name, model: p.defaultModel, configured: p.configured, detail: p.detail };
  };
  return { primary: pick(PRIMARY_PROVIDER), fallback: pick(FALLBACK_PROVIDER) };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    throw new AiError("The AI returned a response that was not valid JSON.", undefined, "invalid_response");
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j?.error?.message ?? j?.message ?? text;
  } catch {
    return text;
  }
}

function mapHttpError(providerName: string, status: number, message: string): AiError {
  const short = message.slice(0, 300);
  if (status === 401 || status === 403) {
    return new AiError(`${providerName} rejected the API key (${status}). Check the configured secret. ${short}`, status, "auth");
  }
  if (status === 402) {
    return new AiError(`${providerName} requires more credits (402). ${short}`, status, "payment");
  }
  if (status === 429) {
    return new AiError(`${providerName} rate limit reached (429). Try again shortly.`, status, "rate_limit");
  }
  if (status === 400) {
    return new AiError(`${providerName} rejected the request (400): ${short}`, status, "upstream");
  }
  return new AiError(`${providerName} is unavailable (${status}): ${short}`, status, "upstream");
}

async function fetchWithTimeout(providerName: string, url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") {
      throw new AiError(`${providerName} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`, undefined, "timeout");
    }
    throw new AiError(`${providerName} could not be reached: ${err.message}`, undefined, "upstream");
  } finally {
    clearTimeout(timer);
  }
}

async function openAiCompatible(
  providerName: string,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetchWithTimeout(providerName, url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await readError(res);
    console.error(`[ai] ${providerName} ${res.status}: ${msg.slice(0, 300)}`);
    throw mapHttpError(providerName, res.status, msg);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }>; refusal?: string } }>;
  };
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new AiError(`${providerName} returned no completion.`, undefined, "invalid_response");
  if (msg.refusal) throw new AiError(`${providerName} refused: ${msg.refusal}`, undefined, "invalid_response");
  const content = Array.isArray(msg.content)
    ? msg.content.map((c) => c.text ?? "").join("")
    : (msg.content ?? "");
  return extractJson(content);
}

// Gemini's responseSchema is an OpenAPI subset; strip unsupported keywords.
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "additionalProperties" || k === "$schema") continue;
      out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return schema;
}

// Remembered across calls so we stop probing model ids once one works.
let resolvedGeminiModel: string | null = null;

async function callGeminiOnce(model: string, args: GenerateJsonArgs): Promise<unknown> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new AiError("Gemini is not configured. Add the GEMINI_API_KEY secret.", undefined, "config");
  const res = await fetchWithTimeout(
    "Gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(args.schema),
        },
      }),
    },
  );
  if (!res.ok) {
    const msg = await readError(res);
    console.error(`[ai] Gemini(${model}) ${res.status}: ${msg.slice(0, 300)}`);
    throw mapHttpError("Google Gemini", res.status, msg);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
  if (json.promptFeedback?.blockReason) {
    throw new AiError(`Gemini blocked the request: ${json.promptFeedback.blockReason}`, undefined, "invalid_response");
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new AiError("Gemini returned an empty response.", undefined, "invalid_response");
  return extractJson(text);
}

async function callGemini(requestedModel: string | null, args: GenerateJsonArgs): Promise<unknown> {
  const explicit = requestedModel?.trim() || process.env["GEMINI_MODEL"]?.trim() || null;
  const candidates = explicit
    ? [explicit, ...GEMINI_MODEL_CANDIDATES.filter((m) => m !== explicit)]
    : resolvedGeminiModel
      ? [resolvedGeminiModel, ...GEMINI_MODEL_CANDIDATES.filter((m) => m !== resolvedGeminiModel)]
      : [...GEMINI_MODEL_CANDIDATES];

  let lastErr: AiError | null = null;
  for (const model of candidates) {
    try {
      const out = await callGeminiOnce(model, args);
      resolvedGeminiModel = model;
      return out;
    } catch (e) {
      const err = e as AiError;
      // Only walk to the next model id when this one does not exist for the key.
      const missingModel = err.status === 404 || (err.status === 400 && /model/i.test(err.message));
      lastErr = err;
      if (!missingModel) throw err;
    }
  }
  throw lastErr ?? new AiError("Gemini returned no usable model.", undefined, "upstream");
}

export async function generateJson<T = unknown>(args: GenerateJsonArgs): Promise<T> {
  const { provider, system, prompt, schema, schemaName } = args;
  const model = args.model?.trim() || defaultModelFor(provider);
  const providerName = DEFAULTS[provider].name;

  if (provider === "lovable") {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new AiError("Lovable AI is not configured (LOVABLE_API_KEY missing).", undefined, "config");
    if (process.env["AI_FORCE_PRIMARY_FAILURE"] === "1") {
      // Controlled failure switch used to exercise the Gemini fallback path.
      throw new AiError("Lovable AI failure forced by AI_FORCE_PRIMARY_FAILURE.", 503, "upstream");
    }
    return (await openAiCompatible(
      providerName,
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      { Authorization: `Bearer ${key}` },
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        reasoning_effort: "low",
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      },
    )) as T;
  }

  if (provider === "openrouter") {
    const key = process.env["OPENROUTER_API_KEY"];
    if (!key) throw new AiError("OpenRouter is not configured. Add the OPENROUTER_API_KEY secret.", undefined, "config");
    return (await openAiCompatible(
      providerName,
      "https://openrouter.ai/api/v1/chat/completions",
      {
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://lovable.dev",
        "X-Title": "Lead Generation OS",
      },
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: true, schema },
        },
      },
    )) as T;
  }

  // Gemini: use a dedicated server secret if present, otherwise run Gemini
  // Flash-Lite through the Lovable AI gateway (server-side, no user key).
  if (!process.env["GEMINI_API_KEY"]) {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new AiError("Gemini fallback is not configured on the server.", undefined, "config");
    return (await openAiCompatible(
      providerName,
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      { Authorization: `Bearer ${key}` },
      {
        model: GATEWAY_GEMINI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
      },
    )) as T;
  }
  return (await callGemini(args.model ?? null, args)) as T;
}

// ---------------------------------------------------------------------------
// Provider chain with validation, one JSON-correction retry, and fallback
// ---------------------------------------------------------------------------

export type AiRunArgs<T> = Omit<GenerateJsonArgs, "provider"> & {
  /** Preferred provider; defaults to Lovable AI. */
  provider?: AiProviderId;
  /** Short task name used for logging only, e.g. "lead_analysis". */
  task: string;
  /** Validates and shapes the raw JSON. Throw or return null to reject it. */
  validate: (raw: unknown) => T | null;
};

export type AiRunResult<T> = {
  data: T;
  provider: AiProviderId;
  model: string;
  usedFallback: boolean;
};

const CORRECTION =
  "\n\nYour previous reply was rejected because it was not valid JSON matching the required schema. Reply again with ONLY the JSON object, no prose and no code fences.";

async function attemptProvider<T>(
  provider: AiProviderId,
  model: string | null,
  args: AiRunArgs<T>,
): Promise<T> {
  const base: GenerateJsonArgs = {
    provider,
    model,
    system: args.system,
    prompt: args.prompt,
    schemaName: args.schemaName,
    schema: args.schema,
  };
  const run = async (prompt: string): Promise<T> => {
    const raw = await generateJson<unknown>({ ...base, prompt });
    let value: T | null = null;
    try {
      value = args.validate(raw);
    } catch (e) {
      throw new AiError(
        `${DEFAULTS[provider].name} returned data that did not match the expected structure: ${(e as Error).message}`,
        undefined,
        "invalid_response",
      );
    }
    if (value === null) {
      throw new AiError(
        `${DEFAULTS[provider].name} returned data that did not match the expected structure.`,
        undefined,
        "invalid_response",
      );
    }
    return value;
  };

  try {
    return await run(args.prompt);
  } catch (e) {
    const err = e as AiError;
    if (err.kind !== "invalid_response") throw err;
    console.warn(`[ai] task=${args.task} provider=${provider} invalid JSON — retrying once with a correction instruction`);
    return await run(args.prompt + CORRECTION);
  }
}

/**
 * Runs a structured AI request through the provider chain:
 * primary (Lovable AI) first, then Gemini Flash-Lite if the primary fails.
 * Never saves unvalidated data: the validator must accept the response.
 */
export async function runAiJson<T>(args: AiRunArgs<T>): Promise<AiRunResult<T>> {
  const primary = args.provider ?? PRIMARY_PROVIDER;
  const started = Date.now();

  const tryProvider = async (id: AiProviderId, isFallback: boolean): Promise<AiRunResult<T>> => {
    const model = isFallback ? null : (args.model ?? null);
    const data = await attemptProvider<T>(id, model, args);
    const used = id === "gemini" && !process.env["GEMINI_API_KEY"] ? GATEWAY_GEMINI_MODEL : id === "gemini" ? (resolvedGeminiModel ?? defaultModelFor(id)) : (model?.trim() || defaultModelFor(id));
    console.info(
      `[ai] task=${args.task} provider=${id} model=${used} fallback=${isFallback} ok=true ms=${Date.now() - started}`,
    );
    return { data, provider: id, model: used, usedFallback: isFallback };
  };

  try {
    return await tryProvider(primary, false);
  } catch (e) {
    const err = e as AiError;
    console.error(`[ai] task=${args.task} provider=${primary} ok=false kind=${err.kind}: ${err.message.slice(0, 200)}`);

    const canFallback =
      primary !== FALLBACK_PROVIDER &&
      isProviderConfigured(FALLBACK_PROVIDER) &&
      ["rate_limit", "payment", "upstream", "timeout", "config", "invalid_response"].includes(err.kind);

    if (!canFallback) throw err;

    console.warn(`[ai] task=${args.task} falling back to ${FALLBACK_PROVIDER}`);
    try {
      return await tryProvider(FALLBACK_PROVIDER, true);
    } catch (e2) {
      const err2 = e2 as AiError;
      console.error(`[ai] task=${args.task} fallback provider=${FALLBACK_PROVIDER} ok=false kind=${err2.kind}`);
      throw new AiError(
        `${DEFAULTS[primary].name} failed (${err.message}) and the Gemini fallback also failed (${err2.message}).`,
        err2.status,
        err2.kind,
      );
    }
  }
}
