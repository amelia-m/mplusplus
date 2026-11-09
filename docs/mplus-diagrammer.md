# Saving `.mdg` files from Mplus's Diagrammer without the File menu

How we get Mplus's own diagram geometry (`.mdg`) and its own picture (PDF) for a `.dgm` without saving each one by hand. Found 2026-11-03 on Mplus 8.11 for Windows (Amelia's machine), with the Java 8 runtime Mplus ships in its install folder. Nothing here is documented by Mplus; it may change with any Mplus release.

## Why

The `.dgm` holds the model, not where Mplus draws it. Mplus's positions are only in the `.mdg` that the Diagrammer's File > Save writes (see the `.mdg` item in `TODO.md`). Parity checks need that geometry for every fixture, and Amelia ruled out both clicking through the window by automation (fragile) and saving every fixture by hand (2026-11-03: "fragile is a bigger concern than tool install. but also I'd prefer not to manually save all of them").

## License

Read on 2026-11-03 in the browser, the page text itself: the [Mplus Single-User License Agreement](https://www.statmodel.com/orderonline/pages.php?pageid=12) (8 sections), the [license information page](https://statmodel.com/orderonline/pages.php?pageid=5) and the store's Terms & Conditions. Section 1 forbids unauthorized copying of Mplus and its written materials, apart from one backup copy and normal system backups, and limits use to one computer at a time. No section mentions reverse engineering, decompiling, automation or calling the program from scripts; section 3 refers to "modified copies". Amelia, 2026-11-03, on which license applies: the public single-user agreement "is fine". This is a reading of the text, not legal advice.

What follows from it here:

- Mplus's program files are run where Mplus installed them and are never copied: not into the repository, not into `_scratch/`.
- No decompiling. Only class and method names were listed, with Java's standard reflection on the running program, and its own methods were called (Amelia, 2026-11-03: "good. be sure to document").
- The `.mdg` and PDF files written for our own synthetic models are output of our models, like the committed `.out` fixture.

## How it works

`Diagrammer.exe` is an exe4j launcher. Its main class is `diagrammer.MDiagrammer` and it runs on the Java 8 runtime in Mplus's `jre` folder; the classes are packed inside the `.exe`, not shipped as a `.jar`. Any Java runtime reads the standard `JAVA_TOOL_OPTIONS` environment variable, so setting it for one launch loads a small Java agent of ours into the Diagrammer's process without changing anything in the Mplus folder:

```
JAVA_TOOL_OPTIONS=-javaagent:<our agent jar>=<arguments>
Diagrammer.exe <path to a .dgm>
```

The agent waits for the diagram to open, then, on the Swing thread:

1. finds the `diagrammer.MDiagrammer` window among `java.awt.Frame.getFrames()`;
2. calls its `getSelectedFrame()` (a `diagrammer.InternalFrame`) and that frame's `getDiagram()` (the drawing, a `diagrammer.Diagrammer`, which extends Processing's `PApplet`);
3. writes the `.mdg` by serializing that object with `java.io.ObjectOutputStream.writeObject`;
4. writes the PDF with the drawing's own `saveToFile(String)` followed by `saveWhenNeeded()`; `saveToFile` only sets a flag (`saveNow`) that the drawing loop would act on, and `saveWhenNeeded()` does the write at once;
5. exits the process.

Result for `dgm/syn_path.dgm`: the `.mdg` is byte for byte identical (`cmp`) to the one Amelia saved by hand from the File menu on 2026-11-02 (8,189 bytes). The PDF is 20,780 bytes, Mplus's own drawing of the diagram.

Tried and not used: `MDiagrammer.save(File, InternalFrame, boolean)` returns `true` with either flag but writes no file when called this way.

A Diagrammer window opens for about 8 seconds per run (the agent waits 6 seconds for the diagram). It needs no clicking, but it is not headless: Processing's `PApplet` is an AWT component and needs a display. Amelia, 2026-11-03: "this is fine".

## Where the code is

The agent source, build steps, class list and test output are in `_scratch/mdg-agent/` (gitignored) for now. Where it should live durably is an open item in `TODO.md`.
