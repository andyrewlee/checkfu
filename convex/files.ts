import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const getFileUrls = query({
  args: { fileIds: v.array(v.id("files")) },
  handler: async (ctx, { fileIds }) => {
    const urls: Record<string, string> = {};
    for (const id of fileIds) {
      const f = await ctx.db.get(id);
      if (!f) continue;
      const url = await ctx.storage.getUrl(f.storageId);
      if (url) urls[id] = url;
    }
    return { urls } as const;
  },
});

export const getFile = query({
  args: { fileId: v.id("files") },
  handler: async (ctx, { fileId }) => {
    return await ctx.db.get(fileId);
  },
});

export const registerFile = mutation({
  args: {
    ownerId: v.id("users"),
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    contentType: v.string(),
    bytes: v.number(),
    purpose: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("files", {
      ownerId: args.ownerId,
      projectId: args.projectId,
      storageId: args.storageId,
      contentType: args.contentType,
      bytes: args.bytes,
      purpose: args.purpose ?? "page_render",
      createdAt: Date.now(),
    });
    return id;
  },
});
