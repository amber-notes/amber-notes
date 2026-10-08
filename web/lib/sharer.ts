import type { SharedNote } from "./shared";

export type Sharer = NonNullable<SharedNote["shared_by"]>;

/** "Shared by": the name if they set one, else their email; never an Apple relay address. */
export function sharerLabel(by: Sharer | null | undefined): { name: string; email: string | null; initials: string } {
  const name = by?.name?.trim() || by?.email || "Amber Notes user";
  const email = by?.name?.trim() && by?.email ? by.email : null;
  const words = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? "A").slice(0, 1)).toUpperCase();
  return { name, email, initials };
}
