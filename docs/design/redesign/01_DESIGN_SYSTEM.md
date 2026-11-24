# Design system: ClientFlow, Relationship & Revenue Intelligence

The tokens live in `apps/web/src/styles/index.css` as Tailwind 4 `@theme` variables. Components use
the token names (`bg-surface`, `text-ink`, `text-primary-strong`), never raw hex values. The only
exception is chart marks, which use the validated series and sequential arrays in
`components/charts/charts.tsx`.

## Point of view

ClientFlow is a ledger of relationships for a small agency. The identity borrows from bookkeeping
paper and old-growth forest:

- an ivory canvas;
- a deep forest frame (the navigation, figures and headings);
- jade for actions;
- violet only for secondary data and proposals.

Figures are set large and tabular, and they read like entries in a ledger. Labels stay small and
quiet. The design does not use:

- gradients as decoration;
- identical KPI cards;
- template blue;
- all-caps eyebrows on every heading.

The one bold element is the forest navigation against the ivory page. Everything else is quiet.

## Colour

The brief's base palette, adjusted where it failed WCAG AA:

| Token | Hex | Role |
| --- | --- | --- |
| `bg` | `#FAF9F6` | Ivory canvas |
| `surface` / `surface-alt` | `#FFFFFF` / `#F3F1EC` | Panels, and sunk wells (table heads) |
| `ink` | `#142D2A` | Forest: headings, figures, navigation background |
| `text` | `#1B2A27` | Body text |
| `muted` | `#5A6763` | Secondary text (darkened from the brief's neutral to pass AA) |
| `subtle` / `control` | `#8C8577` | Icons and control borders only, never text |
| `primary` | `#087F70` | Jade: primary buttons and links |
| `primary-strong` | `#06685C` | Jade text on tinted backgrounds |
| `mint` | `#A5D6B5` | Accents on forest: the active-count pill and the start of the sequential ramp |
| `violet` / `violet-strong` | `#7464C7` / `#5B4BB0` | Second data series, proposals, info notes (`info` is violet) |
| `border` | `#E9E4DB` | The warm neutral from the brief, used for decorative hairlines only |
| `success`, `warning`, `attention`, `danger` | `#1F7A4D`, `#8A5A00`, `#B07A12`, `#B3261E` | Reserved for status. Never used as chart series |

### Measured contrast (WCAG 2.1 relative luminance)

The ratios were computed with the session's contrast script.

| Pair | Ratio | Need |
| --- | --- | --- |
| text on ivory | 14.18 | 4.5 |
| ink on ivory | 13.87 | 4.5 |
| muted on ivory / white / surface-alt | 5.61 / 5.91 / 5.23 | 4.5 |
| jade link on ivory | 4.66 | 4.5 |
| white on jade button | 4.91 | 4.5 |
| primary-strong on primary-soft | 5.75 | 4.5 |
| violet-strong on violet-soft | 5.86 | 4.5 |
| success on success-soft | 4.65 | 4.5 |
| warning on warning-soft | 5.28 | 4.5 |
| danger on danger-soft / white | 5.61 / 6.54 | 4.5 |
| nav text / nav muted on forest | 9.97 / 6.64 | 4.5 |
| white on active nav item | 10.42 | 4.5 |
| mint on forest | 8.96 | 4.5 |
| control border on white | 3.66 | 3 (non-text) |
| series 1–4 marks on white | 4.27, 4.78, 3.72, 5.18 | 3 (graphics) |

Changes from the brief:

- `muted` is darker than a straight warm neutral;
- `#E9E4DB` is used only for borders, because it fails as text at 1.2:1;
- violet text uses `#5B4BB0`, not `#7464C7`, on tints.

## Charts

- **Categorical order.** Jade `#0B8A78`, violet `#7464C7`, amber `#B07A12`, rose `#B04A6E`, always
  in that order. The order was checked with the dataviz palette validator: lightness band,
  chroma, colour-vision separation and contrast all pass.
- **Sequential.** Mint to forest: `#A5D6B5 → #6DBB9F → #2F9B86 → #0B7A6A → #145A50 → #142D2A`. It
  is used for ordered stages and for invoice age.
- **Money.** Amounts are never summed across currencies. A chart with money shows one series or
  small multiple per currency.
- **Marks.** Bars are thin, have 2 px gaps between segments, and have rounded data ends. Axes and
  grid are recessive. Text uses ink and muted tokens, never the series colour.
- **Accessibility.** Every chart has a table or a list. Each chart's question and source are in
  [02_DATA_SOURCES.md](02_DATA_SOURCES.md).

## Type

Inter Variable (optical-size axis) is self-hosted through `@fontsource-variable/inter`, which was already a dependency on `main`.

| Use | Size / line height | Weight and tracking |
| --- | --- | --- |
| Page title (`.page-title`) | 26 / 32 on phones, larger from 768 px | 640, −0.028em, ink |
| Section title | 20 / 28 | 640, −0.02em |
| Panel title | 15 / 22 | 600 |
| Figure (`.figure`) | 22–40, set per use | 560, tabular numbers, −0.03em, ink |
| Body | 14 / 20 | 400 |
| Meta | 12–13 / 18 | 400, `muted` |

Labels are in sentence case. There are no tracked all-caps eyebrows, except the existing small
section headings inside scope documents, which were kept.

## Space, shape and elevation

- **Spacing.** A 4 px grid. Panels pad 20 px. Page gutters are 16 px on phones, 24 px on laptops
  and 40 px at ≥ 1440 px.
- **Radius.** 4 / 6 / 8 / 12 px. Controls use 6 px and panels 8 px. Radius is restrained on
  purpose.
- **Elevation.** Panels are flat, with a hairline border and a 1 px forest-tinted shadow. Only
  popovers, the palette and drawers use `shadow-pop`.

## Motion

- **Easing.** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for entering, and `--ease-drawer` for
  the deal drawer and the phone navigation.
- **Durations.** Durations stay under 300 ms. Button press is a 0.97 scale over 160 ms. The command
  palette opens with no animation, because it is used dozens of times a day.
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)` turns all transitions and animations
  off globally. It was checked by emulating reduced motion in Playwright (see
  [04_VERIFICATION_REPORT.md](04_VERIFICATION_REPORT.md)).

## Components

| Component | File | Notes |
| --- | --- | --- |
| `PageHeader`, `Panel`, `DocumentTitle`, `useDocumentTitle` | `components/ui/page.tsx` | `Panel` replaces its default padding when `bodyClassName` is passed |
| `Button` (primary, secondary, ghost, danger; sm/md) | `components/ui/button.tsx` | Visible focus ring, press scale |
| `Badge`, `Banner`, `EmptyState`, `ErrorState`, `Skeleton` | `components/ui/feedback.tsx` | Every list has a loading, an empty and an error state |
| `Field`, `Input`, `Select`, `Textarea` | `components/ui/form.tsx` | Labels are always visible, errors are linked with `aria-describedby` |
| `Dialog`, `Drawer` | `components/ui/dialog.tsx` | Radix: focus trap, Esc to close, focus returns to the trigger |
| Brand mark | `components/ui/brand.tsx` | One path joining two points: a relationship that becomes work and revenue |
| Charts | `components/charts/charts.tsx` | See above |

## Responsive layout

- **Breakpoints.** 768 (tablet), 1024 (laptop) and 1440 (`wide`).
- **Navigation.** Below 768 px it collapses to a top bar and a drawer. From 768 to 1023 px it is an
  icon rail. From 1024 px the full labelled navigation shows.
- **360 px.** Every screen was captured at 360 px with zero page-level horizontal overflow. Wide
  tables and the kanban scroll inside their own containers.
