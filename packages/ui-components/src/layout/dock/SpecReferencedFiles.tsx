// "Referenced files" — the part of a spec asset's card that deals with a spec
// split across files. A spec's `$ref`s can name other documents; Studio never
// reads a file or opens a connection for one, so each must be supplied as a
// file asset and mapped to the reference (`spec.externalRefs`). This section
// lists every document the spec reaches, which of them are still missing, and
// lets the user supply them: one at a time (Upload… / Choose existing), several
// at once, or a whole folder (matched by path, then by name). Once nothing is
// missing the spec can be taken away as ONE self-contained file — downloaded,
// or saved as a new spec asset — for a tool that reads a single spec file.

import { useRef, useState, type ChangeEvent } from 'react';
import { Download, FilePlus2, FolderUp, Link2, Upload, X } from 'lucide-react';
import type { GlobalFileAsset, SpecExternalRef } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { bundledSpecFile } from '../../store/specSource';
import { Button } from '../../primitives/Button';
import { SectionHeading } from '../../primitives/SectionHeading';
import { downloadTextFile } from '../../primitives/download';
import { cn } from '../../primitives/cn';

const isUrl = (target: string): boolean => /^[a-z][a-z\d+.-]*:/i.test(target);
const NO_FILES: Record<string, GlobalFileAsset> = {};

/** Names of the files an upload left out, a few of them spelled out. */
function leftOut(names: string[]): string {
  const shown = names.slice(0, 4).join(', ');
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown;
}

export function SpecReferencedFiles({ spec }: { spec: GlobalFileAsset }) {
  const files = useWorkspaceStore((s) => s.synced?.globalAssets.files) ?? NO_FILES;
  const uploadRefs = useWorkspaceStore((s) => s.uploadSpecExternalRefs);
  const mapRef = useWorkspaceStore((s) => s.mapSpecExternalRef);
  const saveBundled = useWorkspaceStore((s) => s.saveBundledSpecAsset);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [busy, setBusy] = useState<string | null>(null);
  const manyInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);

  const refs = spec.spec?.externalRefs ?? [];
  if (refs.length === 0) {
    return (
      <p className="mt-2 text-xs text-text-dim">
        Self-contained: this spec references no other files.
      </p>
    );
  }
  const isMapped = (r: SpecExternalRef): boolean => Boolean(r.assetId && files[r.assetId]);
  const missing = refs.filter((r) => !isMapped(r)).length;
  const choices = Object.values(files)
    .filter((f) => f.id !== spec.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const run = async (key: string, work: () => Promise<void>): Promise<void> => {
    setBusy(key);
    try {
      await work();
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Could not update the referenced files',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  /** The files a picker handed over, the picker then cleared so the same pick fires again. */
  const onPicked = (e: ChangeEvent<HTMLInputElement>): void => {
    /* v8 ignore next -- a file input's `files` is a FileList whenever it fires change */
    upload(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const upload = (picked: File[], target?: string): void => {
    if (picked.length === 0) return;
    void run(target ?? 'many', async () => {
      const { mapped, unmatched } = await uploadRefs(spec.id, picked, { target });
      if (target) return;
      if (mapped.length > 0) {
        pushToast({
          tone: 'success',
          title: `Mapped ${mapped.length} referenced file${mapped.length === 1 ? '' : 's'}`,
          detail: mapped.join(', '),
        });
      }
      if (unmatched.length > 0) {
        pushToast({
          tone: 'info',
          title: `${unmatched.length} file${unmatched.length === 1 ? '' : 's'} matched no reference and ${unmatched.length === 1 ? 'was' : 'were'} not uploaded`,
          detail: leftOut(unmatched),
          ttlMs: 10000,
        });
      }
    });
  };

  const download = (): void => {
    void run('download', async () => {
      const file = await bundledSpecFile(useWorkspaceStore.getState().synced, spec.id);
      if (file) downloadTextFile(file.filename, file.text, file.mimeType);
    });
  };

  const saveAsNew = (): void => {
    void run('save', async () => {
      const id = await saveBundled(spec.id);
      if (!id) return;
      pushToast({
        tone: 'success',
        title: `Saved "${spec.name} (one file)"`,
        detail:
          'One file with every reference inside, in the Files list — for any tool that ' +
          'reads a single spec file, with nothing beside it.',
        ttlMs: 10000,
      });
    });
  };

  const notReady =
    missing > 0
      ? `${missing} referenced file${missing === 1 ? ' is' : 's are'} still missing — upload ${missing === 1 ? 'it' : 'them'} first.`
      : null;

  return (
    <section aria-label="Referenced files" className="mt-3 border-t border-accent/20 pt-3">
      <SectionHeading as="h3" size="sm">
        Referenced files
      </SectionHeading>
      <p className={cn('mt-1 text-xs', missing > 0 ? 'text-warning' : 'text-text-muted')}>
        {missing > 0
          ? `${missing} of ${refs.length} referenced file${refs.length === 1 ? '' : 's'} missing — the schemas ${missing === 1 ? 'it holds read' : 'they hold read'} as unknown until you upload ${missing === 1 ? 'it' : 'them'}.`
          : `All ${refs.length} referenced file${refs.length === 1 ? ' is' : 's are'} here: the spec is read in full.`}
      </p>

      <ul className="mt-2 space-y-1.5">
        {refs.map((ref) => (
          <ReferenceRow
            key={ref.target}
            refEntry={ref}
            asset={ref.assetId ? files[ref.assetId] : undefined}
            choices={choices}
            busy={busy === ref.target}
            onUpload={(file) => upload([file], ref.target)}
            onChoose={(assetId) => void run(ref.target, () => mapRef(spec.id, ref.target, assetId))}
          />
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <input
          ref={manyInput}
          type="file"
          multiple
          className="hidden"
          aria-label={`Upload referenced files for ${spec.name}`}
          onChange={onPicked}
        />
        <input
          ref={(el) => {
            folderInput.current = el;
            // Not in React's typings; the attribute is what makes the picker choose a folder.
            el?.setAttribute('webkitdirectory', '');
          }}
          type="file"
          multiple
          className="hidden"
          aria-label={`Upload a folder of referenced files for ${spec.name}`}
          onChange={onPicked}
        />
        <Button
          size="xs"
          leftIcon={<Upload size={11} aria-hidden="true" />}
          loading={busy === 'many'}
          disabled={busy !== null || missing === 0}
          disabledReason={missing === 0 ? 'Every referenced file is already here.' : null}
          onClick={() => manyInput.current?.click()}
        >
          {busy === 'many' ? 'Uploading…' : 'Upload files…'}
        </Button>
        <Button
          size="xs"
          leftIcon={<FolderUp size={11} aria-hidden="true" />}
          disabled={busy !== null || missing === 0}
          disabledReason={missing === 0 ? 'Every referenced file is already here.' : null}
          onClick={() => folderInput.current?.click()}
        >
          Upload folder…
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button
          size="xs"
          variant="primary"
          leftIcon={<Download size={11} aria-hidden="true" />}
          loading={busy === 'download'}
          disabled={busy !== null || missing > 0}
          disabledReason={notReady}
          onClick={download}
        >
          {busy === 'download' ? 'Preparing…' : 'Download one file'}
        </Button>
        <Button
          size="xs"
          variant="primary"
          leftIcon={<FilePlus2 size={11} aria-hidden="true" />}
          loading={busy === 'save'}
          disabled={busy !== null || missing > 0}
          disabledReason={notReady}
          onClick={saveAsNew}
        >
          {busy === 'save' ? 'Saving…' : 'Save as new spec'}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-text-dim">
        One file holds the spec and every file it references, so a tool that reads a single spec
        file — a CLI&apos;s <code className="font-mono">--openapi</code>, say — needs nothing beside
        it.
      </p>
    </section>
  );
}

function ReferenceRow({
  refEntry,
  asset,
  choices,
  busy,
  onUpload,
  onChoose,
}: {
  refEntry: SpecExternalRef;
  asset: GlobalFileAsset | undefined;
  choices: GlobalFileAsset[];
  busy: boolean;
  onUpload: (file: File) => void;
  onChoose: (assetId: string | null) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const { target } = refEntry;
  return (
    <li className="rounded-sm border border-border bg-surface p-2 text-xs">
      <div className="flex min-w-0 items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-text-primary" title={target}>
          {target}
        </code>
        {asset ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-success/40 bg-success/10 px-1.5 text-[0.625rem] text-success">
            <Link2 size={10} aria-hidden="true" />
            {asset.name}
          </span>
        ) : (
          <span className="shrink-0 rounded-sm border border-warning/40 bg-warning/10 px-1.5 text-[0.625rem] uppercase tracking-wider text-warning">
            Missing
          </span>
        )}
      </div>
      {isUrl(target) && (
        <p className="mt-1 text-xs text-text-dim">
          A URL — never fetched. Upload a copy of the file it points at.
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input
          ref={input}
          type="file"
          className="hidden"
          aria-label={`Upload a file for ${target}`}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) onUpload(picked);
            e.target.value = '';
          }}
        />
        <Button
          size="xs"
          leftIcon={<Upload size={11} aria-hidden="true" />}
          loading={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? 'Uploading…' : asset ? 'Replace…' : 'Upload…'}
        </Button>
        <select
          aria-label={`Choose an existing file for ${target}`}
          value={asset ? asset.id : ''}
          disabled={busy || choices.length === 0}
          onChange={(e) => onChoose(e.target.value || null)}
          className="h-6 min-w-0 max-w-[12rem] rounded-sm border border-border bg-card px-1.5 text-[0.6875rem] text-text-primary disabled:opacity-50"
        >
          <option value="">{asset ? 'Not mapped' : 'Choose existing…'}</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {asset && (
          <Button
            size="xs"
            variant="subtle"
            leftIcon={<X size={11} aria-hidden="true" />}
            disabled={busy}
            onClick={() => onChoose(null)}
            aria-label={`Unmap ${target}`}
          >
            Unmap
          </Button>
        )}
      </div>
    </li>
  );
}
