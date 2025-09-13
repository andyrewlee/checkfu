import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { GoogleGenAI as GenAI } from "@google/genai";

// Helpers: base64 <-> Uint8Array without Node Buffer
function base64ToUint8Array(b64: string): Uint8Array {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bufferLength = b64.length * 0.75;
  const len = b64.length;
  if (b64.endsWith("==")) bufferLength -= 2;
  else if (b64.endsWith("=")) bufferLength -= 1;
  const bytes = new Uint8Array(bufferLength | 0);
  let p = 0;
  let bc = 0;
  let bs = 0;
  for (let i = 0; i < len; i++) {
    const c = b64[i];
    if (c === "=") break;
    const val = chars.indexOf(c);
    if (val === -1) continue;
    bs = (bs << 6) | val;
    bc += 6;
    if (bc >= 8) {
      bc -= 8;
      bytes[p++] = (bs >>> bc) & 0xff;
    }
  }
  return bytes.subarray(0, p);
}

function bytesToBase64(bytes: Uint8Array): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let i = 0;
  while (i < bytes.length) {
    const a = bytes[i++] ?? 0;
    const b = bytes[i++] ?? 0;
    const c = bytes[i++] ?? 0;
    const tri = (a << 16) | (b << 8) | c;
    output +=
      chars[(tri >> 18) & 63] +
      chars[(tri >> 12) & 63] +
      (i - 2 <= bytes.length ? chars[(tri >> 6) & 63] : "=") +
      (i - 1 <= bytes.length ? chars[tri & 63] : "=");
  }
  return output;
}

/**
 * ai.generateImage — server-side image generation (Gemini 2.5 Flash Image).
 * Input: freeform prompt (and optional base file). Output: Convex file + URL.
 * Notes:
 * - We request PNG bytes and store them to Convex Storage; the client links by fileId.
 * - Base images are fetched from Storage and passed via inlineData to avoid CORS.
 */
export const generateImage = action({
  args: {
    projectId: v.id("projects"),
    prompt: v.string(),
    baseFileId: v.optional(v.id("files")),
    traceId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { projectId, prompt, baseFileId, traceId },
  ): Promise<{ fileId: Id<"files">; url: string | null }> => {
    const project = (await ctx.runQuery(api.projects.getProjectById, {
      projectId,
    })) as Doc<"projects"> | null;
    if (!project) throw new Error("Project not found");
    // Image generation (server-side): build parts with optional base inlineData, request PNG bytes.

    // Build request for @google/genai (server-side)
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY as
      | string
      | undefined;
    if (!apiKey) throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY");
    const genAI = new (GenAI as any)({ apiKey });
    const parts: any[] = [{ text: prompt }];
    if (baseFileId) {
      const base = await ctx.runQuery(api.files.getFile, {
        fileId: baseFileId,
      });
      if (base) {
        const url = await ctx.storage.getUrl(base.storageId);
        if (url) {
          try {
            const res = await fetch(url);
            const buf = await res.arrayBuffer();
            const b64 = bytesToBase64(new Uint8Array(buf));
            parts.push({
              inlineData: {
                mimeType: base.contentType || "image/png",
                data: b64,
              },
            });
          } catch {
            /* ignore base image if fetch fails */
          }
        }
      }
    }
    // Call whichever surface the client exposes (models.generateContent or generateContent)
    const payload: any = {
      model: "gemini-2.5-flash-image-preview",
      contents: parts,
      generationConfig: { responseMimeType: "image/png" },
    };
    const resp: any = genAI?.models?.generateContent
      ? await genAI.models.generateContent(payload)
      : await genAI.generateContent(payload);
    const contentParts: any[] =
      resp?.candidates?.[0]?.content?.parts ||
      resp?.response?.candidates?.[0]?.content?.parts ||
      [];
    const inline = contentParts.find(
      (p: any) =>
        p?.inlineData?.data &&
        String(p?.inlineData?.mimeType || "").startsWith("image/"),
    );
    if (!inline) {
      throw new Error("No image returned by model.");
    }
    const b64 = inline.inlineData.data as string;
    const mime = inline.inlineData.mimeType as string;
    const bytes = base64ToUint8Array(b64);
    const ab = bytes.buffer as unknown as ArrayBuffer;
    const blob = new Blob([ab], { type: mime || "image/png" });
    const storageId = await ctx.storage.store(blob);
    // ownerId: project.ownerId
    const fileId = await ctx.runMutation(api.files.registerFile, {
      ownerId: project.ownerId,
      projectId,
      storageId,
      contentType: mime || "image/png",
      bytes: bytes.byteLength as number,
      purpose: "page_render",
    });
    const url = await ctx.storage.getUrl(storageId);
    // Done
    return { fileId: fileId as Id<"files">, url };
  },
});

/**
 * ai.generateTextLabel — server-side label generation (Gemini 2.5 Flash).
 * Returns a short text string used to update Text nodes. Client persists via nodes.updateTextNode.
 */
export const generateTextLabel = action({
  args: { prompt: v.string() },
  handler: async (_ctx, { prompt }): Promise<{ text: string }> => {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY as
      | string
      | undefined;
    if (!apiKey) throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY");

    const genAI2 = new (GenAI as any)({ apiKey });
    const payload: any = {
      model: "gemini-2.5-flash",
      contents: [{ text: prompt }],
    };
    const resp: any = genAI2?.models?.generateContent
      ? await genAI2.models.generateContent(payload)
      : await genAI2.generateContent(payload);
    const parts: any[] =
      resp?.candidates?.[0]?.content?.parts ||
      resp?.response?.candidates?.[0]?.content?.parts ||
      [];
    const text =
      (parts.find((p) => typeof p?.text === "string")?.text as
        | string
        | undefined) || "";
    return { text };
  },
});
