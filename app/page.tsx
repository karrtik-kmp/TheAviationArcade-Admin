import { redirect } from "next/navigation";

/** The Admin has one area; its host root opens the workspace. */
export default function Home() {
  redirect("/admin");
}
