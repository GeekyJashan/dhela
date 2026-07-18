/**
 * AI provider selection. Anthropic (Claude) is the default; Gemini is kept as
 * a fallback so we can switch back without a rewrite. Set AI_PROVIDER=gemini
 * on the server to use Gemini instead.
 */
export type AiProvider = "anthropic" | "gemini";

export function aiProvider(): AiProvider {
  return (process.env.AI_PROVIDER ?? "anthropic").toLowerCase() === "gemini" ? "gemini" : "anthropic";
}

export function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
}

/** Whether the selected provider's credentials are present. */
export function aiConfigured(): boolean {
  return aiProvider() === "anthropic" ? !!process.env.ANTHROPIC_API_KEY : !!process.env.GOOGLE_API_KEY;
}

type GeminiSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: readonly string[];
};

type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
};

/** Convert a Gemini function-declaration schema (UPPERCASE types) to JSON Schema. */
export function geminiSchemaToJsonSchema(s: GeminiSchema): JsonSchema {
  const out: JsonSchema = {};
  if (s.type) out.type = s.type.toLowerCase();
  if (s.description) out.description = s.description;
  if (s.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(s.properties)) out.properties[k] = geminiSchemaToJsonSchema(v);
  }
  if (s.items) out.items = geminiSchemaToJsonSchema(s.items);
  if (s.required) out.required = [...s.required];
  return out;
}

/** Map our Gemini tool declarations to Anthropic tool definitions. */
export function toAnthropicTools(
  declarations: readonly { name: string; description: string; parameters: GeminiSchema }[],
) {
  return declarations.map(d => {
    const schema = geminiSchemaToJsonSchema(d.parameters);
    return {
      name: d.name,
      description: d.description,
      input_schema: {
        type: "object" as const,
        properties: schema.properties ?? {},
        ...(schema.required ? { required: schema.required } : {}),
      },
    };
  });
}
