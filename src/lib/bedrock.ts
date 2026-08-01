import { createHash, createHmac } from "node:crypto";

/**
 * Amazon Bedrock via the Converse API.
 *
 * Added as an alternative front door to the same assistant, not a replacement:
 * when it is configured it goes first, and anything that comes back wrong —
 * credentials, permissions, throttling, an outage — falls through to the
 * existing Anthropic or Gemini path rather than failing the question.
 *
 * Signed by hand. @aws-sdk/client-bedrock-runtime is ~2MB of dependency for
 * one POST, and this server already runs on a serverless function where cold
 * start is the thing users feel. SigV4 is a hash chain, not a protocol.
 *
 * Converse is deliberate over InvokeModel: it normalises tools and messages
 * across model families, so pointing this at a non-Anthropic model later is a
 * config change rather than another adapter.
 */

const SERVICE = "bedrock";

export type BedrockTool = {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export type ConverseBlock = Record<string, unknown>;
export type ConverseMessage = { role: "user" | "assistant"; content: ConverseBlock[] };

export function bedrockConfigured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && bedrockModel());
}

export const bedrockRegion = () => process.env.AWS_REGION ?? "us-east-1";

/**
 * Default is a cross-region inference profile: on-demand throughput for the
 * current Claude models is only offered through one, and a bare model id
 * returns a validation error rather than an answer.
 */
export const bedrockModel = () => process.env.BEDROCK_MODEL ?? "us.anthropic.claude-sonnet-4-6";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** AWS Signature Version 4, query-string free (everything here is a POST body). */
function sign(canonicalPath: string, body: string, region: string) {
  const accessKey = process.env.AWS_ACCESS_KEY_ID!;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY!;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    host,
    "x-amz-date": amzDate,
  };
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort()
    .map(k => `${k}:${headers[k].trim()}\n`).join("");

  const canonicalRequest = [
    "POST", canonicalPath, "", canonicalHeaders, signedHeaders, sha256(body),
  ].join("\n");

  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");

  const signature = createHmac(
    "sha256",
    hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), SERVICE), "aws4_request"),
  ).update(toSign).digest("hex");

  return {
    ...headers,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export type ConverseResult = {
  text: string;
  toolUses: { id: string; name: string; input: Record<string, unknown> }[];
  stopReason: string;
};

export async function bedrockConverse(opts: {
  system: string;
  messages: ConverseMessage[];
  tools: BedrockTool[];
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<ConverseResult> {
  const region = bedrockRegion();
  const model = bedrockModel();
  // Model ids contain a colon ("...-v1:0"), and this is where hand-rolled
  // SigV4 goes wrong: the URL carries the colon raw, while the canonical
  // request that gets signed carries it percent-encoded. AWS re-encodes what
  // it receives before checking, so encoding it in both places yields %253A
  // on their side and a signature mismatch on ours. Verified against the live
  // endpoint in both shapes.
  const path = `/model/${model}/converse`;
  const canonicalPath = `/model/${encodeURIComponent(model)}/converse`;

  const body = JSON.stringify({
    system: [{ text: opts.system }],
    messages: opts.messages,
    inferenceConfig: { maxTokens: opts.maxTokens ?? 2048, temperature: 0.2 },
    ...(opts.tools.length
      ? {
          toolConfig: {
            tools: opts.tools.map(t => ({
              toolSpec: {
                name: t.name,
                description: t.description,
                inputSchema: { json: t.input_schema },
              },
            })),
          },
        }
      : {}),
  });

  const resp = await fetch(`https://bedrock-runtime.${region}.amazonaws.com${path}`, {
    method: "POST",
    headers: sign(canonicalPath, body, region),
    body,
    signal: opts.signal,
  });

  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(`Bedrock ${resp.status}: ${detail}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await resp.json();
  const blocks = (json.output?.message?.content ?? []) as ConverseBlock[];
  return {
    text: blocks.filter(b => "text" in b).map(b => (b as { text: string }).text).join("").trim(),
    toolUses: blocks
      .filter(b => "toolUse" in b)
      .map(b => {
        const t = (b as { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }).toolUse;
        return { id: t.toolUseId, name: t.name, input: t.input ?? {} };
      }),
    stopReason: String(json.stopReason ?? ""),
  };
}
