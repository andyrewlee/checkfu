import { GoogleGenAI as GenAI } from "@google/genai";

const IMAGE_MODEL_ID = "gemini-2.5-flash-image-preview";
const TEXT_MODEL_ID = "gemini-2.5-flash";
const STYLE_BLOCK = [
  "Black ink line art only.",
  "Thick outlines.",
  "White background.",
  "No shading or gray.",
  "Ample open white space.",
].join(" ");

function getApiKey(): string {
  const key =
    typeof window !== "undefined"
      ? localStorage.getItem("CHECKFU_GEMINI_API_KEY") || ""
      : "";
  if (!key) {
    throw new Error(
      "Missing API key. Add it by clicking API Key in top right corner of the app. It is used only on the client side.",
    );
  }
  return key;
}

function getClient() {
  const apiKey = getApiKey();
  return new GenAI({ apiKey });
}

type InlineDataPart = { inlineData: { mimeType: string; data: string } };
type TextPart = { text: string };
type Part = InlineDataPart | TextPart;
type GenerateRequest = {
  model: string;
  contents: Part[];
  generationConfig?: { responseMimeType?: string; [k: string]: unknown };
};
type GenerateResponse = {
  candidates?: Array<{ content?: { parts?: Part[] } }>;
  response?: { candidates?: Array<{ content?: { parts?: Part[] } }> };
};

type GenAIClient = {
  models?: {
    generateContent: (req: GenerateRequest) => Promise<GenerateResponse>;
  };
  generateContent?: (req: GenerateRequest) => Promise<GenerateResponse>;
};

async function generateContent(
  client: GenAIClient,
  payload: GenerateRequest,
): Promise<GenerateResponse | null> {
  if (client?.models?.generateContent)
    return client.models.generateContent(payload);
  if (client?.generateContent) return client.generateContent(payload);
  return null;
}

function unwrapParts(res: GenerateResponse | null): Part[] {
  const parts =
    res?.candidates?.[0]?.content?.parts ||
    res?.response?.candidates?.[0]?.content?.parts ||
    [];
  return parts as Part[];
}

async function generateImageObjectUrl(contents: Part[]): Promise<string> {
  const client = getClient();
  const res = await generateContent(client, {
    model: IMAGE_MODEL_ID,
    contents,
    generationConfig: { responseMimeType: "image/png" },
  });
  const parts = unwrapParts(res);
  const part = parts.find((p) => (p as InlineDataPart).inlineData?.data) as
    | InlineDataPart
    | undefined;
  const b64 = part?.inlineData?.data as string | undefined;
  if (!b64) {
    const asText = (
      parts.find((p) => (p as TextPart).text) as TextPart | undefined
    )?.text;
    throw new Error(
      asText
        ? `Model returned text instead of image: ${asText}`
        : "No image in response",
    );
  }
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  return URL.createObjectURL(blob);
}

export async function generateColoringBookImage(
  prompt: string,
): Promise<string> {
  const contents: Part[] = [{ text: `${prompt} ${STYLE_BLOCK}` }];
  return generateImageObjectUrl(contents);
}

export async function transformImageWithPrompt(
  basePngB64: string,
  instruction: string,
): Promise<string> {
  // Keep original ordering used previously (text then image)
  const contents: Part[] = [
    { text: `${instruction} ${STYLE_BLOCK}` },
    { inlineData: { mimeType: "image/png", data: basePngB64 } },
  ];
  return generateImageObjectUrl(contents);
}

export async function editImageWithMaskGuidance(
  basePngB64: string,
  maskPngB64: string,
  instruction: string,
): Promise<string> {
  const contents: Part[] = [
    {
      text: `${instruction} Edit strictly inside the white region in the next mask image. Keep composition style and aspect ratio the same. Do not alter pixels where the mask is black.`,
    },
    { inlineData: { mimeType: "image/png", data: basePngB64 } },
    { inlineData: { mimeType: "image/png", data: maskPngB64 } },
  ];
  return generateImageObjectUrl(contents);
}

export async function generateTextContent(prompt: string): Promise<string> {
  const client = getClient();
  const res = await generateContent(client, {
    model: TEXT_MODEL_ID,
    contents: [{ text: prompt }],
  });
  const parts =
    res?.candidates?.[0]?.content?.parts ||
    res?.response?.candidates?.[0]?.content?.parts;
  const text =
    (parts?.find((p) => (p as TextPart).text) as TextPart | undefined)?.text ||
    "";
  if (!text) throw new Error("No text in response");
  return text.trim();
}
