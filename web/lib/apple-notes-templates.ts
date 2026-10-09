import type { Template } from "./TemplatePicker";

/// Written in Markdown, so Edit, Paste as Markdown in Notes on macOS 27 turns each into a title,
/// headings and real checklists. Every one was pasted that way in a clean macOS 27 VM on 8 October
/// 2026. Every list item has words in it: an empty "- [ ]" pastes as the literal text [ ], and an empty
/// "- " disappears.
export const APPLE_NOTES_TEMPLATES: Template[] = [
  {
    title: "Meeting notes",
    text: `# Meeting notes
Date:
People:

## Agenda
- First topic

## Notes
- What was said

## Decisions
- What we agreed

## Action items
- [ ] Who: what, by when`,
  },
  {
    title: "Weekly review",
    text: `# Weekly review
Week of:

## What went well
- One thing

## What didn't, and why
- One thing

## What I learned
- One thing

## Top three for next week
- [ ] First
- [ ] Second
- [ ] Third`,
  },
  {
    title: "Packing list",
    text: `# Packing list

## Documents
- [ ] Passport or ID
- [ ] Tickets and bookings
- [ ] Travel insurance details

## Clothes
- [ ] Clothes for each day
- [ ] Something warm
- [ ] Comfortable shoes

## Bag
- [ ] Chargers and cables
- [ ] Toiletries
- [ ] Medicines`,
  },
  {
    title: "Groceries by aisle",
    text: `# Groceries

## Fruit and veg
- [ ] Bananas

## Bread and dairy
- [ ] Milk

## Meat and fish
- [ ] Chicken

## Cupboard
- [ ] Pasta

## Frozen
- [ ] Peas

## Household
- [ ] Dish soap`,
  },
  {
    title: "Daily plan",
    text: `# Today

## Top three
- [ ] First
- [ ] Second
- [ ] Third

## If there's time
- [ ] Something small

## Notes
- Anything to remember`,
  },
];
