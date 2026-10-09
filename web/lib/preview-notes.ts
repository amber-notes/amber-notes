// Dev only: made-up shared notes for the preview pages (/n/preview), so the
// shared-note pages can be designed and photographed with no backend and nobody's real note.
import type { SharedFile } from "./render";
import type { SharedNote } from "./shared";

export const PREVIEW_SLUG = "previewpreviewpreviewpreview00";
const DAY_ONE = "11111111-1111-4111-8111-111111111111";
const FOOD = "22222222-2222-4222-8222-222222222222";
const TICKETS = "33333333-3333-4333-8333-333333333333";

const by = { name: "Sara Lind", email: "sara@example.com", avatar: null };

const lisbon = `Lisbon, 4 days in May

Tiles, trams and pastries, at an easy pace.

> Pastéis de nata before 10, trams after 10.

## Before we go

- [x] Book the flights
- [x] Reserve the hotel in Príncipe Real
- [ ] Buy the Lisboa Card
- [ ] Download offline maps

## Bookings

| What | When | Confirmation |
| --- | --- | --- |
| Flights ARN to LIS | 14 May, 07:10 | K7Q2PX |
| Hotel in Príncipe Real, 4 nights | 14 to 18 May | 48213377 |
| Train Lisbon to Sintra | 16 May, 09:10 | CP-55120 |

## Each day

1. Alfama and the castle, then the river at sunset
2. Belém: the monastery, the tower and the pastry shop
3. Sintra by train, back for dinner
4. LX Factory, then tram 28 one last time

[Day one, hour by hour](pane-note:${DAY_ONE})

[Tickets.pdf](pane-file:${TICKETS})

* Bring a light jacket: evenings by the river are cool
* The hills are steep, so comfortable shoes
`;

const dayOne = `Day one, hour by hour

- [ ] 09:00 Coffee and a pastel de nata at the corner
- [ ] 10:30 Walk up through Alfama
- [ ] 12:00 The castle, before the queues
- [ ] 14:00 Lunch: grilled sardines
- [ ] 18:30 The river at sunset
`;

const long = lisbon + `
## Where to eat

Ask for the dish of the day. It is usually the best thing on the menu, and it comes fast.

- Time Out Market for a first look at everything
- A tasca in Alfama for grilled fish
- Pastéis de Belém, early, before the line

## Getting around

The metro is the quick way across town. Trams are for the view, not for speed. \`Viva Viagem\` cards work on both, and on the ferries.

\`\`\`
Airport  →  Saldanha  →  Baixa-Chiado   (red line, then green)
\`\`\`

## Notes from last time

We walked too much on the first day and paid for it on the second. Plan one hill a day. The miradouros are free and the best ones face west.

---

A longer paragraph, to see how the page reads when a note is mostly prose. Lisbon is built on seven hills, and the old neighbourhoods run up and down them in narrow streets that a tram can only just pass through. The light in the late afternoon is the reason people come back.
`;

export const PREVIEW_NOTES: Record<string, { sub?: string; note: SharedNote }> = {
  lisbon: {
    note: { title: "Lisbon, 4 days in May", body: lisbon, updated_at: "2026-09-29T18:39:00Z", include_subnotes: true, is_sub: false, root_title: "Lisbon, 4 days in May", subnotes: [{ id: DAY_ONE, title: "Day one, hour by hour" }, { id: FOOD, title: "Where to eat" }], shared_by: by },
  },
  long: {
    note: { title: "Lisbon, 4 days in May", body: long, updated_at: "2026-09-29T18:39:00Z", include_subnotes: true, is_sub: false, root_title: "Lisbon, 4 days in May", subnotes: [{ id: DAY_ONE, title: "Day one, hour by hour" }], shared_by: { name: "Alexandria Montgomery-Fitzgerald", email: "alexandria.montgomery@example.com", avatar: null } },
  },
  sub: {
    sub: DAY_ONE,
    note: { title: "Day one, hour by hour", body: dayOne, updated_at: "2026-09-28T08:05:00Z", include_subnotes: true, is_sub: true, root_title: "Lisbon, 4 days in May", subnotes: [], shared_by: by },
  },
};

export const PREVIEW_FILES: Record<string, SharedFile> = {
  [TICKETS]: { url: "https://example.com/tickets.pdf", name: "Tickets.pdf", type: "application/pdf", size: 184_000 },
};
