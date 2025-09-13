import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { query } from "./_generated/server";

export const addTextNode = mutation({
  args: {
    pageId: v.id("pages"),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
    rotation: v.number(),
    z: v.number(),
    content: v.string(),
    style: v.optional(
      v.object({
        fontFamily: v.optional(v.string()),
        fontSize: v.optional(v.number()),
        bold: v.optional(v.boolean()),
        italic: v.optional(v.boolean()),
        align: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!user) throw new Error("User missing");
    const id = await ctx.db.insert("nodes", {
      kind: "text",
      pageId: args.pageId,
      x: args.x,
      y: args.y,
      width: args.width,
      height: args.height,
      rotation: args.rotation,
      z: args.z,
      searchableText: args.content,
      content: args.content,
      style: args.style,
      createdAt: Date.now(),
      createdBy: user._id,
    } as any);
    return id;
  },
});

export const updateTextNode = mutation({
  args: {
    nodeId: v.id("nodes"),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    rotation: v.optional(v.number()),
    z: v.optional(v.number()),
    content: v.optional(v.string()),
    style: v.optional(v.any()),
  },
  handler: async (ctx, { nodeId, ...patch }) => {
    const doc = await ctx.db.get(nodeId);
    if (!doc || (doc as any).kind !== "text") return false;
    const toPatch: any = { ...patch };
    if (typeof patch.content === "string") {
      toPatch.searchableText = patch.content;
    }
    await ctx.db.patch(nodeId, toPatch);
    return true;
  },
});

export const addImageNode = mutation({
  args: {
    pageId: v.id("pages"),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
    rotation: v.number(),
    z: v.number(),
    fileId: v.optional(v.id("files")),
    alt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!user) throw new Error("User missing");
    const id = await ctx.db.insert("nodes", {
      kind: "image",
      pageId: args.pageId,
      x: args.x,
      y: args.y,
      width: args.width,
      height: args.height,
      rotation: args.rotation,
      z: args.z,
      searchableText: undefined,
      fileId: args.fileId as any,
      placeholder: args.fileId ? undefined : true,
      alt: args.alt,
      createdAt: Date.now(),
      createdBy: user._id,
    } as any);
    return id;
  },
});

export const updateImageNode = mutation({
  args: {
    nodeId: v.id("nodes"),
    x: v.optional(v.number()),
    y: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    rotation: v.optional(v.number()),
    z: v.optional(v.number()),
    fileId: v.optional(v.id("files")),
    alt: v.optional(v.string()),
  },
  handler: async (ctx, { nodeId, ...patch }) => {
    const doc = await ctx.db.get(nodeId);
    if (!doc || (doc as any).kind !== "image") return false;
    await ctx.db.patch(nodeId, patch as any);
    return true;
  },
});

export const deleteNode = mutation({
  args: { nodeId: v.id("nodes") },
  handler: async (ctx, { nodeId }) => {
    const n = await ctx.db.get(nodeId);
    if (!n) return false;
    await ctx.db.delete(nodeId);
    return true;
  },
});

export const getByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const nodesByPage: Record<string, any[]> = {};
    for (const p of pages) {
      const nodes = await ctx.db
        .query("nodes")
        .withIndex("by_page", (q) => q.eq("pageId", p._id))
        .collect();
      nodesByPage[p._id] = nodes;
    }
    return { nodesByPage } as const;
  },
});
