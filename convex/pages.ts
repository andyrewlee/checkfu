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

export const branchPage = mutation({
  args: {
    parentPageId: v.id("pages"),
    prompt: v.string(),
  },
  handler: async (ctx, { parentPageId, prompt }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const user = await ctx.db
      .query("users")
      .withIndex("by_externalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!user) throw new Error("User missing");

    const parent = await ctx.db.get(parentPageId);
    if (!parent) throw new Error("Parent page not found");

    const now = Date.now();
    // Create child page (copy key meta from parent)
    const childPageId = await ctx.db.insert("pages", {
      projectId: parent.projectId,
      title: `${parent.title} variant`,
      kind: parent.kind,
      // Slight offset in the graph so it doesn't overlap
      x: (parent.x || 0) + 280,
      y: parent.y || 0,
      scale: parent.scale ?? 1,
      orientation: parent.orientation,
      marginInches: parent.marginInches,
      style: parent.style,
      systemPrompt: parent.systemPrompt,
      userPrompt: prompt,
      pageSlug: undefined,
      isPublic: false,
      forkedFromPageId: parentPageId,
      renderFileId: undefined,
      isRoot: false,
      createdAt: now,
      updatedAt: now,
    } as any);

    // Clone nodes from parent into child
    const parentNodes = await ctx.db
      .query("nodes")
      .withIndex("by_page", (q) => q.eq("pageId", parentPageId))
      .collect();

    const insertedNodes: any[] = [];
    for (const n of parentNodes) {
      if ((n as any).kind === "text") {
        const id = await ctx.db.insert("nodes", {
          kind: "text",
          pageId: childPageId as any,
          x: (n as any).x,
          y: (n as any).y,
          width: (n as any).width,
          height: (n as any).height,
          rotation: (n as any).rotation || 0,
          z: (n as any).z || 0,
          searchableText: (n as any).content || "",
          content: (n as any).content || "",
          style: (n as any).style,
          createdAt: now,
          createdBy: user._id,
        } as any);
        insertedNodes.push({
          _id: id,
          kind: "text",
          x: (n as any).x,
          y: (n as any).y,
          width: (n as any).width,
          height: (n as any).height,
          rotation: (n as any).rotation || 0,
          z: (n as any).z || 0,
          content: (n as any).content || "",
          style: (n as any).style,
        });
      } else if ((n as any).kind === "image") {
        const id = await ctx.db.insert("nodes", {
          kind: "image",
          pageId: childPageId as any,
          x: (n as any).x,
          y: (n as any).y,
          width: (n as any).width,
          height: (n as any).height,
          rotation: (n as any).rotation || 0,
          z: (n as any).z || 0,
          searchableText: (n as any).searchableText,
          fileId: (n as any).fileId,
          placeholder: (n as any).placeholder,
          alt: (n as any).alt,
          createdAt: now,
          createdBy: user._id,
        } as any);
        insertedNodes.push({
          _id: id,
          kind: "image",
          x: (n as any).x,
          y: (n as any).y,
          width: (n as any).width,
          height: (n as any).height,
          rotation: (n as any).rotation || 0,
          z: (n as any).z || 0,
          fileId: (n as any).fileId,
          placeholder: (n as any).placeholder,
          alt: (n as any).alt,
        });
      }
    }

    // Create page edge (parent -> child)
    await ctx.db.insert("pageEdges", {
      projectId: parent.projectId,
      srcPageId: parentPageId,
      dstPageId: childPageId,
      label: prompt,
      createdAt: now,
      createdBy: user._id,
    });

    return { pageId: childPageId, nodes: insertedNodes } as const;
  },
});
