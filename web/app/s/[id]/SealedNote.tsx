"use client";
import { useEffect, useState } from "react";
import { NotePage } from "@/lib/NotePage";
import PageFrame from "@/lib/PageFrame";
import { openCopy, type SealedCopy } from "@/lib/sealed-share";
import { EmptyState, Stage } from "@/lib/ui";

/// Opens the sealed copy in this browser with the secret after the #, then shows it like any shared note.
export default function SealedNote({ id, ct, editable }: { id: string; ct: string; editable: boolean }) {
  const [copy, setCopy] = useState<SealedCopy | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    openCopy(ct, id, window.location.hash.slice(1)).then(setCopy, () => setBroken(true));
  }, [ct, id]);
  if (broken) {
    return (
      <Stage>
        <EmptyState title="This link isn't complete">
          The end of the link, after the #, is the key that opens the note. Copy the whole link again and open it here.
        </EmptyState>
      </Stage>
    );
  }
  if (!copy) return <div style={{ minHeight: "100vh" }} aria-busy="true" />;
  const note = {
    title: copy.title, body: copy.body, updated_at: copy.updated_at, include_subnotes: false, is_sub: false, root_title: copy.title,
    subnotes: [], shared_by: copy.shared_by ? { name: copy.shared_by.name, email: null, avatar: null } : null,
  };
  const page = copy.page ? <PageFrame html={copy.page} markdown={copy.body} data={copy.data} label={`${copy.title}, as an app`} /> : null;
  // An Edit link: the app joins the note with the same link (the key travels in its fragment too).
  const edit = editable ? `ambernotes://s/${id}${typeof window === "undefined" ? "" : window.location.hash}` : null;
  return <NotePage slug={id} note={note} files={{}} page={page} sealed editHref={edit} />;
}
