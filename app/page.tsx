import Editor from "@/components/Editor";
import DemoEditor from "@/components/DemoEditor";
import { auth } from "@clerk/nextjs/server";

export default async function Page() {
  const { userId } = await auth();
  // If signed in, start with an empty project (Editor with no pages)
  // If signed out, show a demo editor seeded with a featured preview image.
  return userId ? <Editor /> : <DemoEditor />;
}
