import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Hash, Tag, X } from 'lucide-react';
import { Modal } from '../../primitives/Modal';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * "Release & topics" modal — the dedicated path for cutting a Git tag
 * (and optionally a GitHub Release) on the connected repo's base branch
 * after the corresponding ledger entry has been merged via PR. Decoupled
 * from the Publish modal: publishing only writes the ledger to the
 * working branch; tagging always targets `main`'s HEAD so tags can
 * never point at unmerged commits. (See #6.)
 *
 * Two independently-saveable sections:
 *   1. Tag the latest untagged release — fetches main's workspace.json
 *      ledger, picks the highest version that doesn't yet have a tag,
 *      offers an Override toggle when a tag with that name already
 *      exists, and optionally cuts a matching GitHub Release.
 *   2. Repo topics — chip-list editor that PUTs the full list to
 *      GitHub's topics API. The `apicircle` topic is shown as locked
 *      since it powers marketplace discoverability.
 */

interface ReleaseAndTopicsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ReleaseAndTopicsModal({ open, onClose }: ReleaseAndTopicsModalProps) {
  const tagReleaseVersion = useWorkspaceStore((s) => s.tagReleaseVersion);
  const listRepoTopics = useWorkspaceStore((s) => s.listRepoTopics);
  const setRepoTopics = useWorkspaceStore((s) => s.setRepoTopics);
  const loadLatestUntaggedRelease = useWorkspaceStore((s) => s.loadLatestUntaggedRelease);
  const connectedRepo = useWorkspaceStore((s) => s.local?.connectedRepo);

  // ─── Section 1: tag-release state ───────────────────────────────────
  const [loadingTag, setLoadingTag] = useState(false);
  const [tagLoadError, setTagLoadError] = useState<string | null>(null);
  const [latest, setLatest] = useState<{
    version: string;
    notes: string;
    existingTagSha: string | null;
  } | null>(null);
  const [createGitHubRelease, setCreateGitHubRelease] = useState(false);
  const [notes, setNotes] = useState('');
  const [tagSubmitting, setTagSubmitting] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagSuccess, setTagSuccess] = useState<{
    tagRef: string;
    sha: string;
    releaseUrl?: string;
  } | null>(null);

  // ─── Section 2: topics state ────────────────────────────────────────
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [topicsLoadError, setTopicsLoadError] = useState<string | null>(null);
  const [originalTopics, setOriginalTopics] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [topicDraft, setTopicDraft] = useState('');
  const [topicsSubmitting, setTopicsSubmitting] = useState(false);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [topicsSavedAt, setTopicsSavedAt] = useState<number | null>(null);

  // Reload both sections every time the modal is opened.
  useEffect(() => {
    if (!open) return;
    if (!connectedRepo) return;
    let cancelled = false;

    setLatest(null);
    setTagLoadError(null);
    setTagError(null);
    setTagSuccess(null);
    setNotes('');
    setCreateGitHubRelease(false);
    setLoadingTag(true);
    loadLatestUntaggedRelease()
      .then((res) => {
        if (cancelled) return;
        setLatest(res);
        setNotes(res?.notes ?? '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTagLoadError(err instanceof Error ? err.message : 'Failed to load releases.');
      })
      .finally(() => {
        if (!cancelled) setLoadingTag(false);
      });

    setOriginalTopics([]);
    setTopics([]);
    setTopicDraft('');
    setTopicsLoadError(null);
    setTopicsError(null);
    setTopicsSavedAt(null);
    setLoadingTopics(true);
    listRepoTopics()
      .then((list) => {
        if (cancelled) return;
        setOriginalTopics(list);
        setTopics(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTopicsLoadError(err instanceof Error ? err.message : 'Failed to load topics.');
      })
      .finally(() => {
        if (!cancelled) setLoadingTopics(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, connectedRepo, loadLatestUntaggedRelease, listRepoTopics]);

  const topicsDirty = useMemo(() => {
    if (topics.length !== originalTopics.length) return true;
    const a = [...topics].sort();
    const b = [...originalTopics].sort();
    return a.some((t, i) => t !== b[i]);
  }, [topics, originalTopics]);

  const onAddTopic = () => {
    const trimmed = topicDraft.trim().toLowerCase();
    if (!trimmed) return;
    if (topics.includes(trimmed)) {
      setTopicDraft('');
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed) || trimmed.length > 50) {
      setTopicsError(
        'Topics must start with a letter or digit, contain only lowercase letters, digits, or "-", and be 50 chars or fewer.',
      );
      return;
    }
    setTopicsError(null);
    setTopics((prev) => [...prev, trimmed]);
    setTopicDraft('');
  };

  const onRemoveTopic = (topic: string) => {
    if (topic === 'apicircle') return; // locked — drives marketplace
    setTopics((prev) => prev.filter((t) => t !== topic));
  };

  const onCreateTag = async () => {
    if (!latest) return;
    setTagSubmitting(true);
    setTagError(null);
    try {
      const res = await tagReleaseVersion({
        version: latest.version,
        notes,
        createGitHubRelease,
      });
      setTagSuccess(res);
    } catch (err) {
      setTagError(err instanceof Error ? err.message : 'Failed to create tag.');
    } finally {
      setTagSubmitting(false);
    }
  };

  const onSaveTopics = async () => {
    setTopicsSubmitting(true);
    setTopicsError(null);
    try {
      const persisted = await setRepoTopics(topics);
      setOriginalTopics(persisted);
      setTopics(persisted);
      setTopicsSavedAt(Date.now());
    } catch (err) {
      setTopicsError(err instanceof Error ? err.message : 'Failed to save topics.');
    } finally {
      setTopicsSubmitting(false);
    }
  };

  if (!connectedRepo) return null;

  return (
    <Modal open={open} onClose={onClose} title="Release & topics">
      <div className="space-y-4">
        {/* ───── Section 1: Tag release ───── */}
        <section className="rounded-sm border border-border-subtle bg-surface p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-primary">
            <Tag size={12} aria-hidden="true" className="text-accent" />
            Tag a release on <code className="font-mono">main</code>
          </h3>
          <p className="mb-2 text-[11px] text-text-dim">
            Tags target <code>main</code>&apos;s current HEAD — never an unmerged working-branch
            commit. Publish first via the Workspace card, merge the PR, then tag here.
          </p>

          {loadingTag ? (
            <p className="text-[11px] text-text-muted">Loading releases on main…</p>
          ) : tagLoadError ? (
            <p className="text-[11px] text-danger" role="alert">
              {tagLoadError}
            </p>
          ) : !latest ? (
            <p className="rounded-sm border border-dashed border-border bg-card p-3 text-center text-[11px] text-text-dim">
              Nothing to tag. Every published version on <code>main</code> already has a Git tag.
              Publish a new version from the Workspace card and merge the PR to surface it here.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                <span>Version:</span>
                <code className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-text-primary">
                  v{latest.version}
                </code>
              </div>

              <label className="flex items-start gap-2 text-[11px] text-text-muted">
                <input
                  type="checkbox"
                  checked={createGitHubRelease}
                  onChange={(e) => setCreateGitHubRelease(e.target.checked)}
                  aria-label="Also create GitHub Release"
                  style={{ accentColor: 'rgb(var(--accent))' }}
                  className="mt-0.5"
                />
                <span>
                  Also create a GitHub Release pointing at the tag (uses the notes below as the
                  release body).
                </span>
              </label>

              {createGitHubRelease && (
                <div>
                  <label htmlFor="release-tag-notes" className="block text-[11px] text-text-dim">
                    Release notes
                  </label>
                  <textarea
                    id="release-tag-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    aria-label="Release notes"
                    className="mt-1 w-full resize-y rounded-sm border border-border bg-card px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              )}

              {tagError && (
                <p className="text-[11px] text-danger" role="alert">
                  {tagError}
                </p>
              )}

              {tagSuccess && (
                <p className="rounded-sm border border-success/40 bg-success/10 p-2 text-[11px] text-success">
                  Tagged · <code className="font-mono">{tagSuccess.tagRef}</code> @{' '}
                  <code className="font-mono">{tagSuccess.sha.slice(0, 7)}</code>
                  {tagSuccess.releaseUrl && (
                    <>
                      {' · '}
                      <a
                        href={tagSuccess.releaseUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 underline hover:text-success/80"
                      >
                        View Release
                        <ExternalLink size={10} aria-hidden="true" />
                      </a>
                    </>
                  )}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void onCreateTag()}
                  disabled={tagSubmitting || Boolean(tagSuccess)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  <Tag size={11} aria-hidden="true" />
                  {tagSubmitting ? 'Tagging…' : `Create tag v${latest.version}`}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ───── Section 2: Topics ───── */}
        <section className="rounded-sm border border-border-subtle bg-surface p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-primary">
            <Hash size={12} aria-hidden="true" className="text-accent" />
            Repo topics
          </h3>
          <p className="mb-2 text-[11px] text-text-dim">
            Topics drive marketplace discoverability for public APICircle workspaces. The{' '}
            <code>apicircle</code> topic is locked since the marketplace search depends on it.
            GitHub caps topics at 20.
          </p>

          {loadingTopics ? (
            <p className="text-[11px] text-text-muted">Loading topics…</p>
          ) : topicsLoadError ? (
            <p className="text-[11px] text-danger" role="alert">
              {topicsLoadError}
            </p>
          ) : (
            <div className="space-y-2">
              <div
                aria-label="Repo topics"
                className="flex flex-wrap gap-1.5 rounded-sm border border-border bg-card p-2 min-h-[40px]"
              >
                {topics.length === 0 && (
                  <span className="text-[11px] text-text-dim">No topics set yet.</span>
                )}
                {topics.map((topic) => {
                  const locked = topic === 'apicircle';
                  return (
                    <span
                      key={topic}
                      className={
                        locked
                          ? 'inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent'
                          : 'inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted'
                      }
                    >
                      {topic}
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => onRemoveTopic(topic)}
                          aria-label={`Remove topic ${topic}`}
                          className="text-text-faint hover:text-danger"
                        >
                          <X size={9} aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={topicDraft}
                  onChange={(e) => setTopicDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onAddTopic();
                    }
                  }}
                  placeholder="Add topic (e.g. payments, graphql)"
                  aria-label="New topic"
                  className="h-7 flex-1 rounded-sm border border-border bg-card px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  disabled={topics.length >= 20}
                />
                <button
                  type="button"
                  onClick={onAddTopic}
                  disabled={!topicDraft.trim() || topics.length >= 20}
                  className="inline-flex h-7 items-center rounded-sm border border-border bg-card px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary disabled:opacity-50"
                >
                  Add
                </button>
              </div>

              {topicsError && (
                <p className="text-[11px] text-danger" role="alert">
                  {topicsError}
                </p>
              )}
              {topicsSavedAt !== null && !topicsDirty && !topicsError && (
                <p className="text-[11px] text-success">Topics saved.</p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void onSaveTopics()}
                  disabled={!topicsDirty || topicsSubmitting}
                  className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  {topicsSubmitting ? 'Saving…' : 'Save topics'}
                </button>
              </div>
            </div>
          )}
        </section>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
