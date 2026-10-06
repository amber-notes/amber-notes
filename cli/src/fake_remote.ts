// For tests: an account in memory that behaves like the files tools (the first line is the title,
// a path is folder + title, every change bumps the version).
import { Changed, type Read, type Remote, type RemoteNote } from "./remote.ts";
import { dirOf, retitle, stemOf, titleOf } from "./paths.ts";

type N = { id: string; folder: string; text: string; version: number; parent?: string };

export class FakeRemote implements Remote {
  readonly kind = "files";
  notes = new Map<string, N>();
  calls: string[] = [];
  private n = 0;

  pathOf(n: N): string {
    const name = titleOf(n.text).replace(/\//g, "∕");
    if (n.parent && this.notes.has(n.parent)) return `${this.pathOf(this.notes.get(n.parent)!).replace(/\.md$/, "")}/${name}.md`;
    return `${n.folder ? n.folder + "/" : ""}${name}.md`;
  }
  /** As another device would: add, change, delete. */
  add(folder: string, text: string): string {
    const id = `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`;
    this.notes.set(id, { id, folder, text, version: 1 });
    return id;
  }
  change(id: string, text: string) { const x = this.notes.get(id)!; x.text = text; x.version++; }
  byPath(path: string) { return [...this.notes.values()].find((x) => this.pathOf(x) === path); }

  list(): Promise<RemoteNote[]> {
    this.calls.push("list");
    return Promise.resolve([...this.notes.values()].map((x) => ({ id: x.id, path: this.pathOf(x), version: String(x.version) })));
  }
  read(id: string): Promise<Read> {
    this.calls.push(`read ${id}`);
    const x = this.notes.get(id)!;
    return Promise.resolve({ text: x.text, version: String(x.version), path: this.pathOf(x) });
  }
  create(path: string, text: string, inside?: string): Promise<string> {
    this.calls.push(`create ${path}`);
    const id = this.add(inside ? "" : dirOf(path) || "Notes", text);
    if (inside) this.notes.get(id)!.parent = inside;
    return Promise.resolve(id);
  }
  update(id: string, _base: string, text: string, version: string): Promise<void> {
    this.calls.push(`update ${id}`);
    const x = this.notes.get(id)!;
    if (String(x.version) !== version) return Promise.reject(new Changed(id));
    this.change(id, text);
    return Promise.resolve();
  }
  move(id: string, _from: string, to: string): Promise<void> {
    this.calls.push(`move ${id} ${to}`);
    const x = this.notes.get(id)!;
    x.folder = dirOf(to) || x.folder;
    if (stemOf(to) !== titleOf(x.text)) x.text = retitle(x.text, stemOf(to));
    x.version++;
    return Promise.resolve();
  }
  remove(id: string): Promise<void> {
    this.calls.push(`remove ${id}`);
    this.notes.delete(id);
    return Promise.resolve();
  }
}
