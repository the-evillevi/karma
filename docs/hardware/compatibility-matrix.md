# Karma POS hardware compatibility register

**Version:** 0.1.0 (discovery baseline)<br>
**Reviewed:** 2026-09-29<br>
**Status:** No physical device is confirmed or supported yet.

This matrix separates repository labels from observed hardware and vendor facts. “Candidate” means official documentation describes a relevant family or capability; it is not a compatibility or go decision. A device is supported only after its exact model/interface, host OS/browser, connection, paper, route, and acceptance test are recorded against the actual station.

## What the repository establishes

The settings UI displays `EPSON TM-T20 · Caja` and `Estrella SP700 · Cocina`; they are static prototype labels in [`src/PosApp.jsx:651`](../../src/PosApp.jsx) and `design/Karma POS.dc.html:1325`. The checkout print and send-comanda actions display success toasts at `src/PosApp.jsx:497` and `src/PosApp.jsx:370-374`. Offline checkout currently blocks card payment at `src/PosApp.jsx:185-189`. No printer, drawer, or Mercado Pago adapter is configured in the repository, and no attached physical test evidence was found. These labels do not establish exact model, connection, hardware presence, print route, or successful output.

## Versioned compatibility matrix

| Station / capability | Observed project identifier | Official-document candidate facts | OS / connection known for Karma | Current decision |
| --- | --- | --- | --- | --- |
| POS host and browser print | Browser POS / PWA target unspecified | No host platform is selected in repository documentation. Browser print through the system dialog is the dependency-free manual fallback to investigate; the included HTML fixture only validates that path. | OS, browser name/version, printer queue, permissions, and station network are unknown. | **Unknown / unsupported.** Record the actual host and browser before choosing a driver or direct-print path. |
| Customer receipt printer | `EPSON TM-T20 · Caja` (prototype label only) | **Conditional candidate: TM-T20III only.** Epson documents two distinct configurations: Serial/USB and Ethernet; the Ethernet model alone supports ePOS-Print XML. The guide documents USB, RS-232, 10/100 Ethernet on the Ethernet model, and optional WLAN. It supports 80mm and 58mm roll widths with different printable widths. Epson's Download Center lists Windows 11 x64 software and the JavaScript ePOS SDK for TM-T20III, but this does not prove compatibility with Karma's browser/host. ([TM-T20III Technical Reference Guide](https://files.support.epson.com/pdf/pos/bulk/tm-t20iii_trg_en_reva.pdf), [Epson Download Center](https://download-center.epson.com/softwares/?device_id=TM-T20III&language=es&os=WIN1164&region=US)) | Exact generation/SKU, interface board, firmware, paper width, installed OS/browser, IP/USB route, driver, and ePOS SDK support are unknown. | **Candidate only; no support claim.** Do not infer TM-T20III from the shorter “TM-T20” label. First read the physical model/SKU and interface. |
| Cash drawer | No model or connection shown | The TM-T20III guide documents a drawer-kick connector with two drive circuits. A printer connector does not confirm the attached drawer's electrical compatibility. ([TM-T20III Technical Reference Guide](https://files.support.epson.com/pdf/pos/bulk/tm-t20iii_trg_en_reva.pdf)) | Drawer make/model, cable, pinout, voltage/current, connection to receipt printer, and open/closed sensor are unknown. | **Unknown / unsupported.** Check drawer documentation against the exact printer/interface and perform a witnessed open test. Do not pulse an unverified drawer. |
| Kitchen receipt printer | `Estrella SP700 · Cocina` (prototype label; likely Star family, unconfirmed) | **Conditional candidate: Star Micronics SP700 family only.** Official hardware manual shows interface variants (serial, parallel, USB, Ethernet, WLAN) and model suffix distinctions; model suffix also distinguishes tear-bar versus auto-cutter. The product sheet documents 70mm standard paper and a 58mm guide. The current support page lists Windows printer software plus CUPS resources for Linux/macOS; those driver listings do not prove browser-PWA or Karma routing compatibility. ([SP700 Hardware Manual](https://www.starmicronics.com/support/Mannualfolder/sp700-18w_hm_en.pdf), [SP700 Support Page](https://starmicronics.com/support/products/sp700-support-page/), [SP700 product sheet](https://www.starmicronics.com/Resources/UploadedDataSheet/SP700_Product_Sheet.pdf)) | Exact Star model/suffix, 9/18-pin head, interface card generation, OS/browser, driver, paper width, network route, and destination queue are unknown. | **Candidate only; no support claim.** Confirm the Star Micronics manufacturer and full model before choosing a route. |
| Kitchen route / Comanda | Browser page `/comanda.html` | The project currently shares prototype order state between pages using browser storage and polling; no kitchen printer route is configured. | Which station runs Comanda, whether it is a screen or paper ticket, and how it reaches the kitchen are unknown. | **Unknown.** Verify screen updates and physical print destination separately; a Comanda-page update is not a printed ticket. |
| Mercado Pago Point terminal | No device model, serial suffix, seller account, or terminal ID supplied | Current Mexico Point docs describe the Orders API flow: a backend creates an order, Point loads it, and the POS receives payment status. The target terminal must be configured in PDV mode; the API terminal-list ID can be matched against the physical label's serial suffix. Current docs show Point Smart terminals, but that does not establish this seller's model eligibility. ([Mercado Pago Point overview](https://www.mercadopago.com.mx/developers/es/docs/mp-point/overview), [payment processing](https://www.mercadopago.com.mx/developers/es/docs/mp-point/payment-processing?scope=prod), [order and transaction statuses](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction)) | Model, firmware/app version, PDV eligibility, account/country configuration, network, backend credential owner, webhook endpoint, and terminal-to-register pairing are unknown. | **No-go for adapter selection or production integration yet.** Compatibility investigation is not a pilot blocker and does not cancel EVL-133's post-pilot/M7 commitment. |
| Mercado Pago tips | EVL-111 business decision: 5%, 10%, 15%, 20%, plus “Otro”; any custom peso amount is allowed; all payment methods; show equivalent percentage without rounding/rejecting unusual amounts. | The current Point integration example's response includes `tip_amount`, but the documented create-order example does not establish whether the exact seller terminal can capture each of Karma's required tip choices before authorization. The Point overview's tip support is not enough to settle model/configuration compatibility. ([Point payment-processing example](https://www.mercadopago.com.mx/developers/es/docs/mp-point/payment-processing?scope=prod), [Point overview](https://www.mercadopago.com.mx/developers/es/docs/mp-point/overview)) | Terminal model/settings, account capability, and exact tip capture/settlement behavior are unknown. | **Unknown / no automated tip go.** Test every required suggestion and a custom amount on the real terminal and reconcile the API response, terminal slip, POS amount, and reported `tip_amount`. |
| Offline manual card fallback | Required EVL-117 pilot fallback; distinct from automatic Point integration | Point vendor troubleshooting describes temporarily switching to `STANDALONE` during an integration-service interruption; this is a terminal mode without Point API integration, and must return to PDV mode to restore automatic reconciliation. This documentation does not establish that any particular terminal accepts offline cards. ([Mercado Pago Point troubleshooting](https://www.mercadopago.com.mx/developers/es/docs/mp-point/resources/troubleshooting)) | PWA offline storage implementation and actual terminal offline authorization model are unverified. | **Manual PWA card-tender recording is mandatory for the pilot and must not require PWA internet.** It records an operator-confirmed tender locally as pending reconciliation; it is not terminal authorization. Only label payment captured after the operator verifies an approved terminal result/receipt. Verify duplicate/retry recovery before using this path. |

## Mercado Pago direction and go/no-go

For a new automatic Point integration, investigate the current Mexico Orders API, not the legacy Payment Intents flow. Official Point docs describe listing terminals, matching the returned ID with the physical terminal's serial suffix, configuring terminal mode, creating an order from a backend with an idempotency key, then consuming status notifications. The transaction is not “paid” merely because the order was created or reached the terminal: only the vendor's terminal/payment result can settle that status. See the [integration flow](https://www.mercadopago.com.mx/developers/es/docs/mp-point/overview), [order creation and response example](https://www.mercadopago.com.mx/developers/es/docs/mp-point/payment-processing?scope=prod), and [status definitions](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction).

The documented temporary `STANDALONE` fallback is for an interruption in the Point integration service and is not the same as confirming offline acceptance by the bank/acquirer. It also drops API reconciliation until the terminal is returned to PDV mode. Do not treat it as a proven PWA-offline terminal fallback. Keep EVL-133's automated integration after the pilot; EVL-117's research can produce a no-go or a constrained candidate without blocking manual card recording during the pilot.

**Automatic integration go gate:** exact seller-owned terminal model and terminal ID; eligible country/account/application; successful PDV setup; backend-owned credentials kept out of the PWA/public repository; idempotent create; terminal result/status notification; cancel/retry/duplicate handling; explicit manual offline fallback; receipt/tip reconciliation for every EVL-111 rule; successful operator-witnessed test on the real terminal. Until all are evidenced, status remains **no-go / unknown**, not “compatible.”

## Manual evidence checklist

Capture one record per hardware path and attach it only through the project’s approved private evidence channel. Before anything enters a public repository, redact seller/customer data, credentials, full terminal IDs/serials, IP addresses, and payment-card data. Never put access tokens, secrets, unredacted receipts, or private attachments in this repository.

1. Record station role and location; host make/model; operating system edition/version; browser/version; PWA install mode; local printer queue name; connection method; network/VLAN path and permission prompts.
2. Photograph the device rating label and ports. Transcribe exact make, full model/SKU/suffix, interface card/model/revision, firmware/app version, and paper width. Store serial/terminal IDs only in the restricted evidence record; expose only a masked suffix in review material.
3. For checkout printer: print `print-test-58mm.html`; record selected queue, media width, scaling, date/operator, legibility, line clipping, accent rendering, cut, reprint behavior, and a redacted evidence image. Repeat at 80mm on Epson only if the actual exact model and paper setup support it.
4. For the drawer: record exact drawer model and connection path; compare required electrical characteristics to the printer manual; test one authorized open pulse, verify open/closed feedback if present, and record whether it opens only after the intended cash-payment event. Do not test with unknown wiring.
5. For kitchen: print the fixture's Comanda page to the exact kitchen route; verify folio/table preservation, item quantity, modifiers/notes, readable line wraps, state transition, exactly-once routing, and behavior with the destination unavailable. Also verify the live Comanda screen route separately.
6. For Point: verify terminal label and account pairing, mode, firmware, connectivity; run approved minimum-value test transactions and reversals only under the seller's authorized procedure. Capture POS order ID (masked), terminal result, webhook/status, receipt, amount, IVA treatment, tip choice, report/reconciliation evidence, and duplicate/retry outcomes.
7. For offline manual card: disconnect only the PWA host network while keeping the real terminal in its verified operating mode. Complete a real approved card transaction only if the terminal confirms it; record it in Karma manually; confirm it survives app restart locally with a visible pending-sync state; restore connection; reconcile exactly once against the terminal/provider record; test cancellation/refund policy separately. If terminal acceptance offline is not proven, do not collect offline—still test saving an explicitly unverified manual record in a safe test scenario.
8. Return terminal to intended PDV mode after any temporary standalone test and record confirmed mode/status. Confirm downstream status reconciliation before closing the test.

## Evidence capture format

Use one redacted Markdown record per tested station, linked to the private evidence item by a non-secret reference:

```text
Test ID / matrix version:
Date, operator, witness:
Station role / location:
Host + OS + browser/PWA version:
Device make + full model/SKU + interface:
Firmware / driver / SDK / queue:
Connection + paper/media + route:
Scenario and exact steps:
Expected result:
Observed result (including failures):
POS folio/order ID (masked):
Vendor status/webhook (masked):
Receipt / drawer / kitchen evidence reference:
Offline state and recovery result:
IVA and tip verification against EVL-111:
Duplicate/retry and reconciliation result:
Decision: supported | candidate | unsupported | still unknown:
Follow-up owner and issue:
```

Update this versioned matrix only when the physical facts and witnessed evidence change. A driver listing, vendor feature page, configuration label, printed browser preview, or simulated success toast is not a physical compatibility result.

## Sources checked 2026-09-29

- [Epson TM-T20III Technical Reference Guide](https://files.support.epson.com/pdf/pos/bulk/tm-t20iii_trg_en_reva.pdf)
- [Epson Download Center, TM-T20III / Windows 11 x64](https://download-center.epson.com/softwares/?device_id=TM-T20III&language=es&os=WIN1164&region=US)
- [Star Micronics SP700 Hardware Manual](https://www.starmicronics.com/support/Mannualfolder/sp700-18w_hm_en.pdf)
- [Star Micronics SP700 Support Page](https://starmicronics.com/support/products/sp700-support-page/)
- [Star Micronics SP700 product sheet](https://www.starmicronics.com/Resources/UploadedDataSheet/SP700_Product_Sheet.pdf)
- [Mercado Pago Point overview (Mexico)](https://www.mercadopago.com.mx/developers/es/docs/mp-point/overview)
- [Mercado Pago Point payment processing (Mexico)](https://www.mercadopago.com.mx/developers/es/docs/mp-point/payment-processing?scope=prod)
- [Mercado Pago order and transaction statuses](https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction)
- [Mercado Pago Point troubleshooting (Mexico)](https://www.mercadopago.com.mx/developers/es/docs/mp-point/resources/troubleshooting)
