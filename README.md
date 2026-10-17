# mplusplus

Interactive web application for parsing, laying out, and rendering Mplus `.dgm` diagram files and `.out` model output files to SVG.

The application is built as a self-contained static Single Page Application (SPA). It runs in modern web browsers and can open directly from the local filesystem (`file://`) without requiring a backend server.

## Features

- **Parser**: Tolerant parsing of Mplus `.dgm` syntax and numeric estimate tables, alongside `.out` parameter and p-value output.
- **Graph & Significance**: In-memory graph model supporting latent (`BY`), regression (`ON`), covariance (`WITH`), and synthesized covariance (`COVAR`) relationships, with significance computed via z-scores or extracted p-values.
- **Automated Layout**: Graph layout powered by ELKjs (`elk-layered`).
- **Interactive SVG Canvas**: Rendered via D3 with interactive node drag, box selection, multi-selection moves, and alignment and distribution tools.
- **Inspection & Styling**: An inspector to adjust the selected nodes' and edges' styles, stroke widths and colors, and a global panel for diagram-wide settings, including the significance level (alpha) and the p-value source.
- **Undo / Redo**: History management using Zustand and Zundo temporal middleware. A node drag or a slider scrub is one undo step. Use the toolbar buttons, Ctrl/Cmd+Z to undo, or Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z to redo.

## Repository Structure

- `app/` - SPA source code (`app/src/`), styles, and test suites. `app/test/fixtures/` holds the sample `.out` file used by the `.out` parser tests.
- `dgm/` - Fixture corpus of synthetic Mplus `.dgm` diagrams: invented models fitted by Mplus to simulated data (see [dgm/README.md](dgm/README.md)). Adding fixtures here automatically extends test suite coverage.
- `docs/reference/` - Index of third-party reference documentation, such as the [Mplus Diagrammer guide](https://www.statmodel.com/download/Mplus%20Diagrammer.pdf). See [docs/reference/README.md](docs/reference/README.md); local PDF copies are not committed.

## Getting Started

All development commands run from the `app/` directory.

### Prerequisites

- Node.js (v18 or higher recommended)
- npm

### Development

```bash
cd app
npm install
npm run dev
```

The Vite development server will start at `http://localhost:5173`.

Drop a `.dgm` file anywhere on the page, or click the drop zone to choose one. To attach p-values, then drop the `.out` file from the same model; a `.out` is rejected until a `.dgm` is loaded.

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
