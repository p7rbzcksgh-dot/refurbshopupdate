# TCG Refurb Shop — Editable Starting List
Version 2.1.0 · 28 September 2026

## What is already entered

| Group | Serial-numbered records |
|---|---:|
| SBX — Scanner | 31 |
| CNV — Conveyor | 26 |
| CHS — Chassis | 29 |
| Total | 86 |

The three CHS sheet notes — **No S/N**, **Blank Box 3DP**, and **Missing Box** — are also included as separate, editable **unnumbered notes**, not extra identified units. Their serial fields are blank. Enter the actual serial when verified, move the note to the appropriate record, or delete the note.

The special serial **CNV-22-191** is retained in full and sorted at 191. CNV-083's `(237?) B0/BO` note, CNV-066's `Not Sure` note, the other B0/BO notes, SBX-345's T.D. note, and the nine SBX entries in the Not Disassembled column are preserved. No meaning has been assigned to the unclear abbreviations.

## Edit your starting list

Open **Queue**, choose **SBX**, **CNV**, or **CHS**, and select **Edit** on a record. Change the serial, module type, generation, condition grade, status, received date, source, notes, or verification flag, then select **Save changes**. **Cancel** discards unsaved changes.

Use the **X** and confirmation button to remove a record. Use **+ Receive a refurb unit** to add another record or unnumbered note. Undo and Redo are available for the current browser session. Search includes serials and notes; Export CSV exports the queue in module/numeric order.

Every imported entry starts as **Starter / to confirm**. Generation, condition grade, actual received date and customer/source are blank because the handwritten list did not establish them. No MOs, work completion, parts requests, or inventory consumption are created automatically. Enter the generation before creating an MO.

Once a unit has a linked MO, its module type is protected to avoid changing that job's scope accidentally. The starter records have no linked MOs, so their module types are editable. Corrections to serial/generation update open linked MOs; closed MOs keep their historical snapshots. A unit with linked MOs cannot be deleted until those jobs are dealt with.

## Run this package

All files are at the ZIP root. There is no enclosing app folder, build step, or dependency installation.

For a local test, extract the ZIP, open a terminal in that folder, and run:

```sh
node server.js
```

Open `http://localhost:3000`. The default passcode is unchanged: `566218`, unless you set `REFURB_PASSCODE`.

For your existing deployment, update the repository's app files with the ZIP contents and redeploy. **Keep the existing persistent volume, DATA_DIR, REFURB_PASSCODE and AUTH_SECRET settings. Do not remove or overwrite the live data.json file.** Close old app tabs before the update and reopen/refresh afterward. Deploying these files and verifying the live service remain separate from preparing this package.

## How the import behaves

On the first start of this updated package, the 86 serials and three unnumbered notes are added to the saved queue. Existing matching serials are skipped, not overwritten. The importer checks both queue records and MO serials. Case, spacing and zero-padding differences are matched; year-format CNV-22-191 remains distinct from CNV-191.

When an existing data file is present, the server makes a copy in `DATA_DIR/.refurb-backups/` before adding the starters. The data file then stores a one-time import marker. Future reloads, restarts and redeployments using that same persistent data file **do not reload the seed list**: renamed entries stay renamed and deleted entries stay deleted. Editing starter-units.json after the first import does not change saved records; make subsequent corrections in the app.

For a new local copy without DATA_DIR, data is stored as data.json next to server.js. Deleting that file creates a fresh installation and imports the starter list again. On a hosting service, keeping the same persistent DATA_DIR is necessary to retain edits through redeployments.

The existing app still uses shared whole-state saves rather than simultaneous per-record database transactions. Avoid editing the same shared data at the same time from multiple devices, and refresh before important changes. The passcode is shared-shop access, not separate personal user accounts.

## Included checks

Run `npm test` or `node --test starter-records.test.js` for the 13 dependency-free automated tests. See TEST_RESULTS.md for the local testing scope. No test-run records or live data.json file are included in this package.
