// The app's data (JSON in its own store: encrypted, synced, with Undo), the note's summary line,
// device notifications, and share() for exports (the share sheet on iPhone, a Save panel on the Mac).
export { useStore, useAppData, useCollection, useSettings, useImported, batch, setSummary, share, device } from "amber"
