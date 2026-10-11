import { Checkbox } from '../primitives/Checkbox';

// "Also clear this workspace's Studio data" — the option both confirmations of
// a repository disconnect offer: "Disconnect repo" on the repository card, and
// the Disconnect of the session of the host the repository is on.
//
// Disconnecting leaves the workspace's document where it is, which is what
// moving a workspace to another host wants: connect the next repository and
// push. Someone starting over on another repository wants the opposite, and had
// to delete every request, environment and mock server by hand. So it is
// offered, unticked: left alone, a disconnect keeps everything it always kept.
//
// One component, so the two dialogs cannot describe two different things. What
// ticking it does is `clearStudioData`.

/** The checkbox, with what it removes and what it leaves said beside it. */
export function ClearStudioDataOption({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-sm border border-border bg-surface p-2">
      <Checkbox
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        label="Also clear this workspace's Studio data"
        hint={
          <>
            Its requests, folders, environments, mock servers, plans and global assets all go. A{' '}
            <strong className="font-medium text-text-primary">Before clearing</strong> snapshot is
            captured first, so History → Snapshots can put them back. Run history and saved secrets
            are kept, and whatever was pushed stays in the repository.
          </>
        }
      />
    </div>
  );
}
