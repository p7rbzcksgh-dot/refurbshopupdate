# TCG Refurb Shop

**Version 2.1.0 — editable starter list, 28 September 2026.** Start with **START_HERE.md** for this update. The package adds 31 SBX, 26 CNV and 29 CHS serial-numbered starter records, plus three separate unnumbered CHS notes. It adds Queue editing, module filters, numeric sorting, unknown-value fields and a one-time additive import that preserves edits and deletions. The existing branding and workflow remain in place.

Passcode-protected shop-floor tracking for TCG Machines refurb work. The app follows a refurb from shipping/receiving through module inspection, upgrade planning, parts and 3D-print coordination, teardown, cleaning, installation, refurb pre-test, regular testing and final shipping.

The package is intentionally flat and GitHub/Railway ready. There is no build step and no `npm install` requirement.

## Default access

The included default shop passcode is:

```text
566218
```

For deployment, set `REFURB_PASSCODE` to change it without editing the code. The passcode gate protects the shared data API as well as the interface. This is a shared internal-shop passcode, not an individual user-account system.

## Refurb workflow

1. **Shipping receives the return** into the Queue as either a full machine or an individual Scanner, Conveyor or Chassis module.
2. **The refurb team generates one MO** for the received unit.
3. **Full machines are separated and inspected** as Scanner, Conveyor and Chassis. Individual module returns use the same inspection form for the selected module.
4. **Required upgrades are listed** by module and the inspection scope is confirmed.
5. **Required parts are assigned a supply source:** refurb inventory, 3D print request or external/other.
6. **Each MO can generate its own Refurb Print Request** (`RPR-####`) with revision control, quantities, module assignments, estimated filament and printable/CSV views.
7. **3D Printing confirms, starts and marks the request ready.** That status flows back to the MO and advances the unit into teardown/clean/upgrade work.
8. **The refurb team records teardown, cleaning, upgrades and pre-test**, then hands the job into regular testing.
9. **Testing and final shipping are tracked in the Queue** until the unit is marked shipped.

## Main features

- Intake Queue for full machines and individual modules
- MO-linked Scanner, Conveyor and Chassis inspection records
- Required-upgrade checklist by module
- Required-parts list with stock, print and external supply sources
- MO-specific Refurb Print Requests with submitted, confirmed, printing, ready and cancelled states
- Combined open print demand for the printing department
- Refurb-owned parts inventory with on-hand, reserved, available, minimum-stock and location fields
- Stock issue/return history tied to refurb MOs
- Ten-step refurb workflow and pre-test record
- Odoo repair-order CSV export plus intake, inventory and print-request CSV exports
- Session undo/redo and shared server persistence
- English, Simplified Chinese and Cantonese/Traditional Chinese interface options
- Responsive desktop, tablet and phone layouts
- Fully local runtime assets; the app does not depend on a public UI CDN

## Run locally

Node.js 18 or newer is required.

```bash
npm start
```

Or:

```bash
node server.js
```

Open `http://localhost:3000` and enter the shop passcode.

State is saved to `data.json` beside the app by default. That file is ignored by Git so live shop data is not accidentally committed.

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | app directory | Folder containing the live `data.json` file |
| `REFURB_PASSCODE` | `566218` | Shared shop passcode |
| `AUTH_SECRET` | derived fallback | Secret used to sign authentication cookies |

Set a long, random `AUTH_SECRET` in production. Authentication cookies are HTTP-only and use `SameSite=Strict`; they are also marked `Secure` when the app is reached through HTTPS.

## Railway deployment

1. Put all package files at the root of a GitHub repository.
2. Create a Railway service from that repository. Railway will use `npm start`.
3. Add a persistent Railway Volume to the service.
4. Set `DATA_DIR` to that volume's mount path, such as `/data`.
5. Set `REFURB_PASSCODE` and a long random `AUTH_SECRET`.
6. Deploy and open the Railway URL.

Without a persistent volume, Railway filesystem data can be lost during redeployment.

## Data and compatibility

All team members use the same shared JSON state. Writes are serialized in each browser and saved atomically by the server. Different devices can still overwrite each other with whole-state saves; avoid simultaneous edits and refresh before important changes. This design is appropriate for a small internal refurb team; it is not a multi-user relational ERP database.

Older TCG Refurb Shop state is normalized and migrated automatically when it is read or saved. For the supported state format, existing machines, MOs, parts and MO numbering are retained, then supplemented with the new module, workflow, print-request, pre-test and inventory fields.

## Package files

| File | Purpose |
|---|---|
| `server.js` | Zero-dependency Node server, passcode authentication and persistent JSON API |
| `index.html` | App shell |
| `app.js` | Refurb workflow, MO, print-request and inventory interface |
| `styles.css` | Responsive TCG Refurb Shop styling |
| `i18n.js` | English, Simplified Chinese and Cantonese/Traditional Chinese strings |
| `vendor-preact-htm.js` | Local Preact + HTM browser runtime |
| `seed-parts.json` | Initial PR3–PR6 refurb parts library |
| `starter-units.json` | One-time editable starter records transcribed from Craig's list |
| `starter-records.js` | Import, serial sorting/matching, and queue edit helpers |
| `starter-records.test.js` | Dependency-free automated regression tests |
| `START_HERE.md` | This update's editing and deployment instructions |
| `TEST_RESULTS.md` | Local verification scope and limitations |
| `logo.png` | TCG Refurb Shop branding |
| `THIRD-PARTY-NOTICES.md` | Runtime attribution and license texts |

## Odoo export

MO exports use one repair order per MO with required parts represented as child rows. In Odoo, use the Repairs import tool and map the CSV headings to your repair-order and repair-line fields. Part numbers are exported in the `Parts/Product` column so they can be mapped by internal reference.
