# Karma POS design system

This document is the implementation reference for the Karma POS visual language and interaction rules. It describes the current prototype honestly, sets explicit rules for the shadcn/ui migration, and calls out decisions that still need operator review. It does not claim that responsive behavior, production synchronization, device integration, or team approval already exists.

## Product principles

Karma is a café point of sale for busy operators. The interface should feel warm and composed while making the next safe action obvious.

1. **Fast in the service path.** Product selection, quantity changes, open-account handling, checkout, and kitchen progress should keep the amount and order context in view. Avoid animation or confirmation steps that delay routine work.
2. **Prevent costly mistakes.** Keep prices, quantities, modifiers, discounts, payment allocation, change, and order reference legible together. Confirm destructive or financially consequential actions, require a reason where the existing flow requires it, and preserve an audit trail.
3. **Make state explicit.** Distinguish draft, open, paid, canceled, refunded, pending synchronization, synchronized, and conflict states with text and a second visual cue. Never imply that a local demo operation reached a bank terminal, printer, kitchen device, or remote backup.
4. **Respect the operator's attention.** Use quiet surfaces, short Spanish labels, direct feedback, and compact dense data. Save stronger emphasis for the primary action and exceptions.
5. **Work with touch and keyboard.** Common actions need generous targets and visible focus. Preserve keyboard access and screen-reader names as the layout changes.

## Brand and visual direction

The prototype establishes a warm ivory, charcoal, toasted-brown, and muted clay palette. Its visual character pairs an editorial italic serif for the Karma wordmark and headline totals with a plain utilitarian sans-serif for controls and dense records. Keep the overall treatment minimal, quiet, and practical; do not introduce decorative café imagery, gradients, glass effects, or ornamental shadows.

The values below are read from `src/PosApp.jsx`, `src/ComandaApp.jsx`, `src/styles.css`, and the retained source prototypes under `design/`. They are the verified starting palette, not colors sampled from an unprovided brand guide.

| Token | Value | Current use |
| --- | --- | --- |
| `--background` | `#f0eee6` | Warm ivory application canvas and input surface |
| `--card` | `#faf9f5` | Paper cards, fields, and navigation |
| `--foreground` | `#141413` | Charcoal body text and dark Comanda canvas |
| `--primary` | `#836953` | Toasted brown primary action, link, and emphasis |
| `--primary-foreground` | `#faf9f5` | Text on toasted-brown actions |
| `--muted-foreground` | `#6b6a63` | Secondary text |
| `--border` | `#e2e0d6` | Dividers and outlines |
| `--accent` | `#f6e5df` | Muted clay selection and pending-state surface |
| `--placeholder` | `#a8a69c` | Existing placeholder text only; do not use for required information |

Do not add new palette colors during the token migration without recording the reason and checking them against the warm neutral base. The prototype does not define a complete dark theme. The Comanda page has a charcoal outer canvas, but its content cards remain light; that is not evidence for a dark POS mode. Treat a full dark theme as out of scope until it is designed and reviewed.

### Contrast behavior

Use WCAG 2.2 AA as the implementation target: at least 4.5:1 for normal text, 3:1 for large text and meaningful non-text boundaries, and a clearly visible focus indicator. Calculations from the verified sRGB values give approximately 4.85:1 for primary on paper, 5.15:1 for muted text on paper, and 17.50:1 for charcoal on paper. Primary on the clay surface is approximately 4.18:1, so do not use that pairing for normal-size text; use charcoal text on clay or put primary text on paper. Placeholder gray on paper is approximately 2.32:1, so labels and help text must carry the meaning independently of placeholder text. Recheck every actual semantic foreground/background pairing when implementing states.

## Typography

The prototype uses the system sans stack `Helvetica Neue, Helvetica, Arial, sans-serif` for interface text and `Georgia, serif` in italic for the Karma wordmark and large monetary totals. Preserve these roles and stacks in the migration; no bundled font is present.

Use the following explicit scale as implementation guidance. Values marked as prototype evidence are directly present in the UI; intermediate values are a consistent scale for new components.

| Role | Size / line height | Use |
| --- | --- | --- |
| `display` | 30–32px / 1.0, Georgia italic | Order total and checkout total |
| `brand` | 23px / 1.0, Georgia italic | Comanda wordmark |
| `page-title` | 20px / 1.25 | Screen title |
| `section-title` | 15–16px / 1.35 | Card and dialog heading |
| `body` | 14px / 1.45 | Default controls and readable content |
| `body-small` | 12.5–13px / 1.45 | Secondary metadata and dense rows |
| `caption` | 11–12px / 1.35 | Status detail, timestamps, compact metadata |
| `eyebrow` | 10.5px / 1.3, 0.12–0.16em tracking, uppercase | Group labels only |

Use weight 400 for regular content and 500 for emphasis, as in the existing prototype. Avoid using uppercase tracked text for long labels, table content, or instructions. Use tabular numerals for prices, quantities, and totals when the selected font supports them.

## Shape, spacing, and elevation

The UI currently uses 6px, 7px, 8px, 9px, 10px, 12px, and 14px corner radii, with frequent 8–12px card radii and pill-shaped chips. Normalize new shared components to these values:

| Token | Value | Use |
| --- | --- | --- |
| `--radius-sm` | 6px | Compact quantity and inline controls |
| `--radius-control` | 8px | Fields and small buttons |
| `--radius-button` | 9px | Primary and secondary buttons |
| `--radius-card` | 12px | POS panels and cards |
| `--radius-card-large` | 14px | Comanda cards |
| `--radius-pill` | 999px | Category filters and badges |

Use a 4px base spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, and 48px. This makes current 6px and 10px gaps legacy exceptions rather than scale anchors. On desktop, content gutters are 24px in the POS shell and 14–24px in secondary views. Keep one primary action per visual group. Use the verified `--border` color for card outlines and dividers; the current design does not use elevation shadows. Prefer border and surface contrast over shadow. Add a shadow only when a floating layer must be distinguished from content beneath it.

## Layout and responsive behavior

The current POS is a desktop-first prototype: its shell has a fixed 236px navigation sidebar, a fixed 360px current-order panel, several 230–340px panels, and no responsive CSS breakpoints. The Comanda prototype is constrained to a 390px-wide device frame with a 760px minimum height. These are audit findings, not mobile acceptance evidence.

Adopt these breakpoints for the migration unless visual QA shows a specific layout needs an earlier transition:

| Breakpoint | Behavior |
| --- | --- |
| `< 640px` phone | One-column screens, sticky compact top bar, navigation in a shadcn Sheet, order/payment actions reachable above the software keyboard, no page-level horizontal scrolling |
| `640–767px` large phone / small tablet | One-column POS with collapsible catalog filters; current order in a Sheet or bottom drawer |
| `768–1023px` tablet | Navigation collapses to icons or a Sheet depending on orientation; order panel may stack below the catalog; retain large touch targets |
| `1024–1279px` compact desktop | Sidebar visible; catalog and order panel side by side when their measured minimum widths fit |
| `≥ 1280px` wide desktop | Full navigation and two-column POS; constrain content width where long lines reduce scanning |

The chosen breakpoints are a new implementation decision because the repository currently has none. Test phone portrait and landscape, tablet portrait and landscape, compact desktop, and wide desktop. The mobile navigation contract is: sticky top bar opens a Sheet containing the same destinations, connectivity/sync state, user controls, and open-order count; selecting a destination closes it and returns focus to the menu trigger. Use a Sheet or Drawer for current-order and edit panels where a side-by-side layout no longer fits. Keep payment totals and the active primary action visible without covering focused fields.

## Shared component rules

Build shared components with shadcn/ui primitives and Karma tokens. Components must keep their semantic HTML, keyboard behavior, and accessible names when restyled.

| Component | Anatomy and variants | Interaction and responsive rule |
| --- | --- | --- |
| Button | Primary toasted-brown filled; secondary paper with border; quiet text; destructive charcoal with explicit warning copy; loading and disabled states | One primary action per region. Provide a visible focus ring. Loading keeps the label/context available to assistive tech and prevents duplicate submission. On touch screens target at least 44×44 CSS px. |
| Card | Paper surface, 1px border, 12px radius; optional compact density for order and kitchen cards | Keep title, state, key values, and available action grouped. Stack card contents on narrow widths. |
| Input / select / textarea | Label, control, optional hint and inline error; ivory field surface, border, 8px radius | Persistent label is required; placeholder is an example only. Associate errors with the field. Use numeric/decimal input modes for quantities and money. Focus must not be hidden by the keyboard or Sheet. |
| Table | Header labels, aligned cells, row separators, sortable/actionable row semantics | Desktop uses a real table when data is tabular. At phone widths convert each record to a labeled card or allow an explicitly labeled horizontal scroller; never clip values silently. Keep totals and status visible. |
| Navigation | Desktop sidebar and compact mobile top bar + Sheet | Indicate the current destination with more than color alone. Sheet supports Escape, focus containment, close-on-selection, and focus restoration. |
| Dialog | Title, concise consequence, optional fields/reason, cancel, confirm | Focus enters the dialog and returns to the invoking control. Escape cancels when safe. Destructive actions require a reason where required by the current workflow and use explicit action labels. |
| Alert / banner | Inline or sticky status with icon/label and explanatory text | Offline banner remains visible until state changes. Do not communicate an exception by color alone. Reserve alerts for persistent or blocking conditions. |
| Badge | Short text label with neutral, pending, success, or conflict role | Always show a text label; pair color with icon or shape. Ensure contrast against its actual surface. |
| Toast / feedback | Short result sentence, optional action for reversible recovery | Existing prototype toasts disappear after 4.2 seconds. Keep transient feedback brief, announce it politely to assistive tech, and do not use it as the only record of payment, conflict, or destructive outcome. |

## POS data density and task flows

Keep dense information scannable and preserve the value-to-action relationship. Product catalog tiles show product name, price, and availability; modifiers must disclose price changes before adding the item. Current-order rows show quantity, item, modifiers/notes, and line total, with quantity/remove actions labeled for assistive tech. Keep subtotal, discount, and total together. In checkout, keep order summary, tip, payment methods, paid amount, remaining amount, and change visible before registration. Do not hide the final total behind a tab or bottom overlay.

Open orders should show folio, table or reference, age/time, operator, preparation state, sync state, item summary, and available actions. Inventory rows should preserve item, unit/type, current quantity, threshold, and availability status. Recipe views should keep ingredient quantity and unit paired. Kitchen cards prioritize folio, item quantities, modifiers, special notes, elapsed/created time, preparation status, and one clear next action. Reports may use denser desktop tables, but must retain labeled values in their phone presentation. Avoid relying on color, position, or icon alone to identify any amount, status, or action.

Recommended: show `$148.50` as a labeled total adjacent to “Registrar pago”; label a pending record “Por sincronizar” and retain that label until confirmed; require “Cancelar cuenta” plus a reason for cancellation. Discouraged: displaying only a green check after a simulated operation; using a disabled-looking button without explaining why; hiding the difference between a local save and a remote sync; using a placeholder as the field label; truncating an amount, order folio, modifier, or conflict action.

## Loading, empty, error, offline, and conflict states

Every asynchronous or data-driven view must have a designed loading, empty, error, and success state. Existing prototype examples include “Cargando estación”, “Sin productos”, “No hay cuentas abiertas”, checkout processing, checkout success/error, and “Sin conexión”. Keep these patterns direct and contextual. Loading indicators must not be the only explanation of a blocked action. Empty states should say what is empty and how to create or find content when that is possible.

Use these synchronization meanings consistently:

| State | Label and behavior |
| --- | --- |
| Local draft | “Borrador” or “Sin guardar”; do not imply persistence until the local write succeeds |
| Saved locally, pending | “Guardado en esta caja · Por sincronizar”; retain the operation and pending count until a remote service confirms it |
| Syncing | “Sincronizando…”; prevent duplicate sync, keep pending count visible, and allow the operator to continue only where safe |
| Synced | “Sincronizada”; show only after an actual server acknowledgment |
| Conflict | “Conflicto”; identify the order and affected values, offer review/resolve actions, and preserve both versions until an operator choice is recorded |
| Blocked | Explain the dependency and next step, such as card terminal unavailable offline; do not show payment success |
| Failed | Explain whether data remains safely local, provide retry where safe, and preserve the original operation |

Important evidence boundary: the repository currently persists the prototype state to `localStorage`, syncs the POS and Comanda pages through browser `storage` events/polling, simulates connectivity with a toggle, and simulates synchronization with a timeout. Some settings, reports, printing, and backup feedback are explicitly simulated. This is useful prototype behavior; it does not prove durable storage, remote sync, conflict reconciliation, payment-terminal operation, printing, or recovery guarantees. The shadcn migration must not relabel these as production capabilities. A real conflict resolution flow must retain both server and local versions until an explicit, auditable choice; the current prototype's “keep local version” action is not sufficient evidence for a safe production merge.

## Accessibility and motion

- Target WCAG 2.2 AA contrast for text and meaningful controls; check actual token pairs, including badges, focus rings, disabled states, and overlays.
- All actions work by keyboard with a logical tab order. Use native buttons and form controls; do not create click-only `div` controls.
- Show a clear focus indicator on every interactive element. Focus must remain visible and unobscured by sticky bars, drawers, and virtual keyboards.
- Use a minimum 44×44 CSS px touch target for frequent and destructive controls. Separate adjacent targets enough to prevent accidental activation. The prototype's 24×24px quantity buttons are below this target and must be enlarged.
- Give icon-only controls an accessible name. Associate inputs with persistent labels, hints, and validation messages. Announce non-blocking changes through a polite live region and urgent/blocking errors through an appropriate alert.
- Dialogs and Sheets manage focus, support Escape when safe, restore focus on close, and do not leave keyboard users behind an overlay.
- Respect `prefers-reduced-motion`. Keep transitions brief (150–200ms maximum for routine state changes), and do not animate essential information or gate the next action on animation.
- Preserve text zoom and reflow at 200% without losing order totals, controls, labels, or status.

## Spanish content conventions

Use concise, consistent Spanish for operator-facing copy. Prefer verbs that describe the action: “Guardar cuenta”, “Enviar comanda”, “Registrar pago”, “Sincronizar ahora”. Use sentence case, retain accents and punctuation, and explain the result when an action changes money or order state. Format money in Mexican pesos with two decimals as the prototype currently does. Use “Por sincronizar” for pending local work and “Sincronizada” only for acknowledged work. Avoid status messages that imply a printer, terminal, backup, or remote service succeeded when the operation is simulated or unavailable.

## Tailwind and shadcn mapping

Map the existing values into shadcn's semantic CSS variables in `:root`; do not paste the palette independently into every component. At minimum map `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `destructive-foreground`, `border`, `input`, `ring`, and `radius`. `popover` can use the paper surface. Keep every variable tied to the verified tokens above; where the current prototype lacks a dedicated semantic color (such as destructive or focus ring), document and approve the chosen mapping before shipping rather than silently inventing a brand color.

Expose radii through Tailwind utilities backed by `--radius`; retain the component-specific radius table above. Keep typography roles in a small set of named utilities rather than ad hoc pixel values. Use semantic variants such as `default`, `secondary`, `outline`, `ghost`, and `destructive` only when their resulting contrast and meaning match Karma's roles. The migration issue EVL-156 should consume this document after the foundation dependency is ready; EVL-158 should apply the responsive and mobile navigation rules after the shared layer exists.

## Current UI audit and migration checkpoints

Verified from the current source and retained design prototype:

- Warm palette, serif italic totals/wordmark, sans-serif controls, thin borders, and compact paper cards are already present.
- Several radii, font sizes, button heights, and spacing values are repeated inline instead of shared tokens.
- The desktop POS has fixed 236px navigation and 360px order panels. Tables use fixed column grids, and source CSS contains no responsive breakpoints.
- Comanda's source defines a 390px presentation width and 46px minimum height for its primary kitchen action, but this is a framed prototype rather than proof of device validation.
- Quantity controls are 24px square; multiple common actions are also below the 44px touch target guideline.
- Inputs suppress the browser outline inline; a replacement focus treatment is not established in the existing CSS.
- A few muted, placeholder, and accent-on-clay combinations do not meet the normal-text contrast target; pairings need to be corrected or restricted as described above.
- State persistence and cross-page updates use browser storage. Connectivity, sync, printing, exports, and backups include simulated behavior.

EVL-154 defines the contract. EVL-156 should implement the tokens and common primitives, then EVL-158 should implement the mobile shell and responsive adaptations. Preserve existing task behavior while adding semantics and accessibility; validate the real UI with representative POS, kitchen, checkout, inventory, and report data.
