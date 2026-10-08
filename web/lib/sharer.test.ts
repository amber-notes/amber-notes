import { describe, expect, it } from "vitest";
import { sharerLabel } from "./sharer";
import { avatarURL } from "./shared";

describe("shared by", () => {
  it("shows the name with the email under it", () => {
    expect(sharerLabel({ name: "Emil Wagman", email: "emil@example.com", avatar: null })).toEqual({ name: "Emil Wagman", email: "emil@example.com", initials: "EW" });
  });
  it("falls back to the email, then to a neutral label", () => {
    expect(sharerLabel({ name: null, email: "emil@example.com", avatar: null })).toEqual({ name: "emil@example.com", email: null, initials: "E" });
    expect(sharerLabel({ name: null, email: null, avatar: null }).name).toBe("Amber Notes user");
    expect(sharerLabel(undefined).name).toBe("Amber Notes user");
  });
  it("only builds photo URLs for real photo names", () => {
    expect(avatarURL("../../etc/passwd")).toBeNull();
    expect(avatarURL(null)).toBeNull();
  });
});
