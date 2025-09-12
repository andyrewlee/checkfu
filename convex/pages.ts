import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const createPage = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    kind: v.string(),
    x: v.number(),
    y: v.number(),
  },
  handler: async (ctx, { projectId, title, kind, x, y }) => {
    const now = Date.now();
    const pageId = await ctx.db.insert("pages", {
      projectId,
      title,
      kind,
      x,
      y,
      scale: 1,
      orientation: undefined,
      marginInches: undefined,
      style: undefined,
      systemPrompt: "",
      userPrompt: "",
      pageSlug: undefined,
      isPublic: false,
      forkedFromPageId: undefined,
      renderFileId: undefined,
      isRoot: false,
      createdAt: now,
      updatedAt: now,
    });
    return pageId;
  },
});

export const updatePageMeta = mutation({
  args: {
    pageId: v.id("pages"),
    title: v.optional(v.string()),
    orientation: v.optional(v.string()),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    scale: v.optional(v.number()),
  },
  handler: async (ctx, { pageId, ...patch }) => {
    const page = await ctx.db.get(pageId);
    if (!page) return false;
    await ctx.db.patch(pageId, {
      ...patch,
      updatedAt: Date.now(),
    } as any);
    return true;
  },
});

export const deletePageDeep = mutation({
  args: { pageId: v.id("pages") },
  handler: async (ctx, { pageId }) => {
    const page = await ctx.db.get(pageId);
    if (!page) return false;
    // delete edges
    const bySrc = await ctx.db
      .query("pageEdges")
      .withIndex("by_src", (q) => q.eq("srcPageId", pageId))
      .collect();
    const byDst = await ctx.db
      .query("pageEdges")
      .withIndex("by_dst", (q) => q.eq("dstPageId", pageId))
      .collect();
    for (const e of [...bySrc, ...byDst]) await ctx.db.delete(e._id);
    // delete nodes
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_page", (q) => q.eq("pageId", pageId))
      .collect();
    for (const n of nodes) await ctx.db.delete(n._id);
    // delete page
    await ctx.db.delete(pageId);
    return true;
  },
});
