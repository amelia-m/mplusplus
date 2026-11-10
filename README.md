# mplusplus

Interactive web application for parsing, laying out, and rendering Mplus `.dgm` diagram files and `.out` model output files to SVG.

mplusplus is an independent project: it is not official, and it is not affiliated with, endorsed by or maintained by Muthén & Muthén, the makers of Mplus.

The application is built as a self-contained static Single Page Application (SPA). It runs in modern web browsers and can open directly from the local filesystem (`file://`) without requiring a backend server.

## Features

- **Parser**: Tolerant parsing of Mplus `.dgm` syntax and estimate tables (including constraint labels and confidence limits), and of `.out` model results and p-values. A `.out` can also be opened on its own, without a `.dgm`.
- **Graph & Significance**: In-memory graph model supporting latent (`BY`), regression (`ON`), covariance (`WITH`), and synthesized covariance (`COVAR`) relationships, with significance from the estimate's t-statistic (estimate / SE against 1.96 and 2.576) or from the `.out`'s p-values.
- **Layout**: A structural equation modeling layout (`sem`) that follows Mplus's own column placement where the `.dgm` gives it, fans indicators out from their factor, keeps paths straight, puts residuals on the diagram's outer edges and draws covariances as curves. Every rule and its source is in [docs/diagram-conventions.md](docs/diagram-conventions.md).
- **Labels**: Estimates with their standard errors (`0.81 (0.04)`), optional 95% confidence limits, covariance values, and editable display names for variables. Labels slide along their paths to keep clear of each other.
- **Interactive SVG Canvas**: Rendered via D3 with node drag, box selection, multi-selection moves, alignment and distribution, rotate and flip, zoom and pan (Ctrl/Cmd + wheel or pinch to zoom, wheel or middle-button drag to pan), and a Fit button.
- **Inspection & Styling**: An inspector to adjust the selected nodes' and edges' styles, stroke widths, colors and residual sides, and a global panel for diagram-wide settings, including the significance level (alpha) and the p-value source. Light and dark page themes.
- **Export**: SVG and PNG downloads, and PDF through the browser's print dialog, each recording where the diagram came from (source file name and SHA-256 hash, app version, export date, coefficient mode, weight, whether a `.out` was attached) as a small block under the diagram, which can be hidden, and as metadata in SVG and PNG files.
- **Undo / Redo**: History management using Zustand and Zundo temporal middleware. A node drag or a slider scrub is one undo step. Use the toolbar buttons, Ctrl/Cmd+Z to undo, or Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z to redo.
- **Autosave**: The open diagram and its edits are saved in the browser and come back after a reload; diagrams from closed tabs are kept and listed under Open recent. Nothing leaves the browser.

## Repository Structure

- `app/` - SPA source code (`app/src/`), styles, and test suites. `app/test/fixtures/` holds the synthetic `.out` files used by the `.out` tests.
- `dgm/` - Fixture corpus of Mplus `.dgm` diagrams: mostly synthetic (invented models fitted by Mplus to simulated data), plus a few from openly licensed (CC0 or CC BY 4.0) published replication packages. Each file's source and license are in [dgm/README.md](dgm/README.md). Adding fixtures here automatically extends test suite coverage.
- `tools/mplus/` - The Mplus inputs of the synthetic fixtures (`synthetic/`) and scripts that run Mplus over the User's Guide examples and public models for local comparison.
- `docs/` - Drawing and layout decisions with their sources ([diagram-conventions.md](docs/diagram-conventions.md)), notes on Mplus's Diagrammer ([mplus-diagrammer.md](docs/mplus-diagrammer.md)) and plans. `docs/reference/` indexes third-party reference documentation, such as the [Mplus Diagrammer guide](https://www.statmodel.com/download/Mplus%20Diagrammer.pdf); see [docs/reference/README.md](docs/reference/README.md). Local copies of copyrighted references are not committed.

## Getting Started

All development commands run from the `app/` directory.

### Prerequisites

- Node.js 18, or 20 or later (what Vite 5.4 and Vitest 2.1 require)
- npm

The diagrams the app opens come from Mplus: a `.dgm` is the diagram file Mplus writes beside its output when run with its `/diagram` option, and a `.out` is the output itself, so using the app on your own models needs Mplus. Developing it does not: the tests use the committed fixtures in `dgm/` and `app/test/fixtures/`, and the demo examples need nothing else. Mplus is needed to regenerate fixtures from the inputs in `tools/mplus/synthetic/`, and for the local reference material described in [docs/reference/README.md](docs/reference/README.md).

### Development

```bash
cd app
npm install
npm run dev
```

The Vite development server will start at `http://localhost:5173`.

Drop a `.dgm` file anywhere on the page, or click the drop zone to choose one. To try the app without Mplus, open a demo example from the drop zone; each one's `.dgm` and `.out` files can also be downloaded there. With Mplus installed, its own User's Guide examples (in the `Mplus Examples` folder of the installation, inputs and outputs) are more models to try: a single-group example's `.out` opens on its own, and running an example with Mplus's `/diagram` option also writes its `.dgm`. They are Muthén & Muthén's files, so this repository does not include them. To attach a model's p-values, drop its `.out` once its `.dgm` is loaded. A `.out` dropped with no diagram loaded opens as a diagram on its own, laid out by the app rather than by Mplus (a note on the diagram says so); for now this covers single-group models with continuous outcomes, and other outputs (multiple groups, categorical outcomes, mixture, multilevel, Bayesian, Monte Carlo) are refused with the reason.

### Testing

```bash
cd app
npm test             # Run test suite once (Vitest)
npm run test:watch   # Run tests in watch mode
```

### Production Build

```bash
cd app
npm run build
```

Emits the production bundle to `app/dist/`. The output uses relative asset paths (`base: './'`) so `app/dist/index.html` can be opened directly in a browser.

## License

Copyright 2026 Amelia Miramonti. mplusplus is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version (`LGPL-3.0-or-later`). See [COPYING.LESSER](COPYING.LESSER) and the GNU General Public License it builds on, [COPYING](COPYING). It is distributed in the hope that it will be useful, but without any warranty; see the licenses for details.

The synthetic fixtures (in `dgm/`, `tools/mplus/synthetic/` and `app/test/fixtures/`) and the published models in `dgm/` have their own terms, given in [dgm/README.md](dgm/README.md). `AGENTS.md` includes the Clanker Constitution (Kenn Software LLC), which keeps its own license, CC BY 4.0.

## AI assistance

Implemented with Claude Code (Anthropic).
