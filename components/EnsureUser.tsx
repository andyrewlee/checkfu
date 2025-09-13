"use client";

import { useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function EnsureUser() {
  const { isSignedIn, user } = useUser();
  const ensureUser = useMutation(api.users.ensureUser);
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !user) return;
    if (lastUserId.current === user.id) return;
    lastUserId.current = user.id;
    void ensureUser({});
  }, [isSignedIn, user, ensureUser]);

  return null;
}
