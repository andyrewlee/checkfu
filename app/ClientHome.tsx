"use client";

import { SignedIn, SignedOut } from "@clerk/nextjs";
import Editor from "@/components/Editor";
import DemoEditor from "@/components/DemoEditor";

export default function ClientHome() {
  return (
    <>
      <SignedIn>
        <Editor />
      </SignedIn>
      <SignedOut>
        <DemoEditor />
      </SignedOut>
    </>
  );
}
