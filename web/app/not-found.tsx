export default function NotFound() {
  return (
    <div className="shell">
      <main className="page empty">
        <img src="/mark.png" alt="" width={56} height={56} />
        <h1 className="title">This note isn’t shared</h1>
        <p className="lede">The link may have been stopped, or the note moved to Recently Deleted. Ask whoever sent it for a new link.</p>
      </main>
    </div>
  );
}
