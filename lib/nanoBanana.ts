import { GoogleGenAI as GenAI } from '@google/genai';

const MODEL_ID = 'gemini-2.5-flash-image-preview';
const STYLE_BLOCK = [
  'Black ink line art only.',
  'Thick outlines.',
  'White background.',
  'No shading or gray.',
  'Ample open white space.'
].join(' ');

function getApiKey(): string {
  const key = typeof window !== 'undefined' ? (localStorage.getItem('CHECKFU_GEMINI_API_KEY') || '') : '';
  if (!key) {
    throw new Error('Missing API key. Add it by clicking API Key in top right corner of the app. It is used only on the client side.');
  }
  return key;
}

function getClient() {
  const apiKey = getApiKey();
  return new GenAI({ apiKey });
}

async function generateContent(client: any, payload: { model: string; contents: any[] }) {
  if (client?.models?.generateContent) return client.models.generateContent(payload);
  if (client?.generateContent) return client.generateContent(payload);
  return null;
}

async function generateImageObjectUrl(contents: any[]): Promise<string> {
  const client = getClient();
  const res: any = await generateContent(client, { model: MODEL_ID, contents });
  const parts = res?.candidates?.[0]?.content?.parts || res?.response?.candidates?.[0]?.content?.parts;
  const part = parts?.find((p: any) => p.inlineData);
  const b64 = part?.inlineData?.data as string | undefined;
  if (!b64) throw new Error('No image in response');
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  return URL.createObjectURL(blob);
}

export async function generateColoringBookImage(prompt: string): Promise<string> {
  const contents = [{ text: `${prompt} ${STYLE_BLOCK}` }];
  return generateImageObjectUrl(contents);
}

export async function transformImageWithPrompt(basePngB64: string, instruction: string): Promise<string> {
  const contents = [
    { text: `${instruction} ${STYLE_BLOCK}` },
    { inlineData: { mimeType: 'image/png', data: basePngB64 } },
  ];
  return generateImageObjectUrl(contents);
}

export async function editImageWithMaskGuidance(basePngB64: string, maskPngB64: string, instruction: string): Promise<string> {
  const contents = [
    { text: `${instruction} Edit strictly inside the white region in the next mask image. Keep composition style and aspect ratio the same. Do not alter pixels where the mask is black.` },
    { inlineData: { mimeType: 'image/png', data: basePngB64 } },
    { inlineData: { mimeType: 'image/png', data: maskPngB64 } },
  ];
  return generateImageObjectUrl(contents);
}
