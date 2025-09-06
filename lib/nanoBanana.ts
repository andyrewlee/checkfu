export async function generateColoringBookImage(prompt: string): Promise<string> {
  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('CHECKFU_GEMINI_API_KEY') || '' : '';
  if (!apiKey) throw new Error('Missing API key. Add it by clicking API Key in top right corner of the app. It is used only on the client side.');
  const { GoogleGenAI: GenAI } = await import('@google/genai');
  const client = new GenAI({ apiKey });

  const styleBlock = [
    'Black ink line art only.',
    'Thick outlines.',
    'White background.',
    'No shading or gray.',
    'Ample open white space.'
  ].join(' ');

  const contents = [{ text: `${prompt} ${styleBlock}` }];
  const modelId = 'gemini-2.5-flash-image-preview';

  const res: any = (client.models && client.models.generateContent)
    ? await client.models.generateContent({ model: modelId, contents })
    : await (client.generateContent ? client.generateContent({ model: modelId, contents }) : null);

  const parts = res?.candidates?.[0]?.content?.parts || res?.response?.candidates?.[0]?.content?.parts;
  const part = parts?.find((p: any) => p.inlineData);
  const b64 = part?.inlineData?.data as string | undefined;
  if (!b64) throw new Error('No image in response');
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  return URL.createObjectURL(blob);
}

export async function transformImageWithPrompt(basePngB64: string, instruction: string): Promise<string> {
  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('CHECKFU_GEMINI_API_KEY') || '' : '';
  if (!apiKey) throw new Error('Missing API key. Add it by clicking API Key in top right corner of the app. It is used only on the client side.');
  const { GoogleGenAI: GenAI } = await import('@google/genai');
  const client = new GenAI({ apiKey });
  const styleBlock = [
    'Black ink line art only.',
    'Thick outlines.',
    'White background.',
    'No shading or gray.',
    'Ample open white space.'
  ].join(' ');
  const contents = [
    { text: `${instruction} ${styleBlock}` },
    { inlineData: { mimeType: 'image/png', data: basePngB64 } },
  ];
  const modelId = 'gemini-2.5-flash-image-preview';
  const res: any = (client.models && client.models.generateContent)
    ? await client.models.generateContent({ model: modelId, contents })
    : await (client.generateContent ? client.generateContent({ model: modelId, contents }) : null);
  const parts = res?.candidates?.[0]?.content?.parts || res?.response?.candidates?.[0]?.content?.parts;
  const part = parts?.find((p: any) => p.inlineData);
  const b64 = part?.inlineData?.data as string | undefined;
  if (!b64) throw new Error('No image in response');
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  return URL.createObjectURL(blob);
}

export async function editImageWithMaskGuidance(basePngB64: string, maskPngB64: string, instruction: string): Promise<string> {
  const apiKey = typeof window !== 'undefined' ? localStorage.getItem('CHECKFU_GEMINI_API_KEY') || '' : '';
  if (!apiKey) throw new Error('Missing API key. Add it by clicking API Key in top right corner of the app. It is used only on the client side.');
  const { GoogleGenAI: GenAI } = await import('@google/genai');
  const client = new GenAI({ apiKey });
  const contents = [
    { text: `${instruction} Edit strictly inside the white region in the next mask image. Keep composition style and aspect ratio the same. Do not alter pixels where the mask is black.` },
    { inlineData: { mimeType: 'image/png', data: basePngB64 } },
    { inlineData: { mimeType: 'image/png', data: maskPngB64 } },
  ];
  const modelId = 'gemini-2.5-flash-image-preview';
  const res: any = (client.models && client.models.generateContent)
    ? await client.models.generateContent({ model: modelId, contents })
    : await (client.generateContent ? client.generateContent({ model: modelId, contents }) : null);
  const parts = res?.candidates?.[0]?.content?.parts || res?.response?.candidates?.[0]?.content?.parts;
  const part = parts?.find((p: any) => p.inlineData);
  const b64 = part?.inlineData?.data as string | undefined;
  if (!b64) throw new Error('No image in response');
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  return URL.createObjectURL(blob);
}
