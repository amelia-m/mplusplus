/**
 * The small dialog each Export button opens: it lists what the export
 * records about its source, with a choice to leave out the file name (the
 * hash stays) and a toggle for the visible block (`render/export.ts`).
 */
import {
  DEFAULT_EXPORT_CHOICES,
  exportDiagram,
  provenanceEntries,
  provenanceFor,
  type ExportChoices,
  type ExportKind,
  type ExportSource,
} from '../render/export.js';

const KIND_TITLES: Record<ExportKind, string> = {
  svg: 'Export SVG',
  png: 'Export PNG',
  pdf: 'Export PDF',
};

const KIND_NOTES: Record<ExportKind, string> = {
  svg: 'Embedded in the SVG as metadata, and shown under the diagram unless hidden:',
  png: 'Embedded in the PNG as text chunks, and shown under the diagram unless hidden (2x resolution):',
  pdf: 'Shown under the diagram unless hidden. A PDF made through print carries no metadata, so hiding the block leaves no record in the file. Choose "Save as PDF" in the print dialog:',
};

/**
 * The warning the dialog shows while the visible block is hidden for a PDF,
 * or null: a PDF made through print carries no metadata, so without the
 * block it has no record of its source (Amelia, 2026-11-04: hiding it is
 * allowed, with a warning). SVG and PNG keep the record in the file.
 */
export function pdfProvenanceWarning(kind: ExportKind, choices: Pick<ExportChoices, 'showVisible'>): string | null {
  if (kind !== 'pdf' || choices.showVisible) return null;
  return 'With the provenance hidden, this PDF will carry no record of its source. Tick the box above to keep it.';
}

/**
 * Open the dialog for `kind`. `source` is null when no diagram is loaded:
 * then `onMessage` says so and nothing opens.
 */
export function openExportDialog(kind: ExportKind, source: ExportSource | null, onMessage: (text: string, error?: boolean) => void): void {
  if (!source) {
    onMessage('Load a diagram first, then export it.');
    return;
  }
  document.querySelector('dialog.export-dialog')?.remove();

  const choices: ExportChoices = { ...DEFAULT_EXPORT_CHOICES };
  const dialog = document.createElement('dialog');
  dialog.className = 'export-dialog';

  const heading = document.createElement('h2');
  heading.textContent = KIND_TITLES[kind];
  const note = document.createElement('p');
  note.textContent = KIND_NOTES[kind];
  const list = document.createElement('dl');
  list.className = 'export-fields';

  const checkbox = (label: string, checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement => {
    const wrap = document.createElement('label');
    wrap.className = 'export-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    wrap.append(input, ` ${label}`);
    return wrap;
  };

  // The listed date is when the dialog opened; the file records the export's own time.
  const refresh = async () => {
    const record = await provenanceFor(source, choices);
    list.replaceChildren(
      ...provenanceEntries(record).flatMap((e) => {
        const dt = document.createElement('dt');
        dt.textContent = e.label;
        const dd = document.createElement('dd');
        dd.textContent = e.value;
        return [dt, dd];
      }),
    );
  };

  const warning = document.createElement('p');
  warning.className = 'export-warning';
  warning.setAttribute('role', 'status');
  const showWarning = () => {
    const text = pdfProvenanceWarning(kind, choices);
    warning.textContent = text ?? '';
    warning.hidden = text === null;
  };
  showWarning();

  const buttons = document.createElement('div');
  buttons.className = 'export-buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => dialog.close());
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn';
  go.textContent = kind === 'pdf' ? 'Print' : 'Export';
  go.addEventListener('click', () => {
    dialog.close();
    exportDiagram(kind, source, { ...choices }).catch((err: unknown) =>
      onMessage(`Export failed: ${(err as Error).message}`, true),
    );
  });
  buttons.append(cancel, go);

  dialog.append(
    heading,
    note,
    list,
    checkbox('Include the source file name (the hash is always kept)', choices.includeFileName, (v) => {
      choices.includeFileName = v;
      refresh().catch(() => undefined);
    }),
    checkbox('Show the provenance on the diagram', choices.showVisible, (v) => {
      choices.showVisible = v;
      showWarning();
    }),
    warning,
    buttons,
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  refresh().catch((err: unknown) => onMessage(`Could not hash the source file: ${(err as Error).message}`, true));
  dialog.showModal();
  go.focus();
}
