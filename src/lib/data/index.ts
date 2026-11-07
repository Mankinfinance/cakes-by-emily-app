import "server-only";
import type { Repository } from "./repository";

/** True when running on the in-memory test adapter. */
export function isMemoryMode(): boolean {
  return process.env.DATA_ADAPTER === "memory";
}

let repo: Repository | null = null;

export async function getRepo(): Promise<Repository> {
  if (repo) return repo;
  if (isMemoryMode()) {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("The in-memory test adapter cannot run in production.");
    }
    repo = (await import("./memory")).memoryRepository;
  } else {
    repo = (await import("./supabase")).supabaseRepository;
  }
  return repo;
}
