# Local verification — 28 September 2026

## Automated checks

`npm test` passed all 13 tests with Node.js 22.16.0:

- Exact membership and numerical order for all 86 serials, plus three separately labelled, blank-serial CHS notes.
- No invented generation, grade, received date, source, completed work or MO.
- Preservation of handwritten notes and uncertainty.
- One-time import after edits and deletions; existing-record and MO duplicate checks.
- Canonical serial matching without losing year-format identifiers.
- Editing all starter fields and converting an unnumbered note into an identified unit.
- Duplicate edit prevention; open-MO synchronization and closed-MO snapshot preservation.
- Real HTTP API authentication, private data/source paths, saving and server restart persistence.
- Removal of all starters remains respected on the next restart.
- Existing data backed up before import; corrupt data left untouched rather than replaced.

The server, frontend, language file and shared helper module also passed JavaScript syntax checks.

## Browser interaction checks

Twelve local browser checks passed using headless Chromium at 1440 × 1000 and 390 × 844 viewport sizes. They exercised unlock, initial counts/grouping/order, editing, save/reload, cancellation, duplicate prevention, delete/undo/redo, module filters, note search, CSV export, generation validation, creation of an individual scanner MO, the existing app tabs, translated edit controls, and mobile editing. No JavaScript runtime errors occurred in these tested interactions. The mobile queue and edit form had no page-level horizontal overflow. Desktop and mobile screenshots were visually inspected.

The container's browser blocks URL navigation, so the browser checks loaded the actual app scripts and styles into a local test page and routed fetch calls through a test-only bridge to the real Node server. The bridge is not included in the deployment app. Direct HTTP API behavior was tested independently by the automated suite.

## Not covered

This package has not been pushed to GitHub or deployed to the user's Railway service. Tests did not access or modify that live service or its data. A real iPhone/Safari session, external Odoo imports, live print requests and simultaneous multi-user editing were not tested. The inherited shared-state save model is unchanged.
