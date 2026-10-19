import type { ReactElement } from 'react';
import { Tooltip } from './Tooltip';

interface DisabledReasonProps {
  /**
   * Why the control is unavailable right now, as a sentence: "Add a request
   * to the workspace first." `null` while no reason applies.
   */
  reason: string | null | undefined;
  /** Classes for the wrapper, for a control that takes part in its row's layout. */
  className?: string;
  /** The one control it explains. Its own `disabled` decides when the reason shows. */
  children: ReactElement<{ disabled?: boolean }>;
}

/**
 * Says why a control is disabled, on hover and on keyboard focus: a greyed-out
 * button with no reason leaves the user guessing what to do first.
 *
 * The reason shows only while the control is disabled and a reason is given,
 * so a caller can pass the same reason expression whatever the state is. The
 * wrapper stays in place either way (the `Tooltip` wrapper), so the control
 * never moves in the DOM when it becomes available.
 */
export function DisabledReason({ reason, className, children }: DisabledReasonProps) {
  const shows = Boolean(reason) && children.props.disabled === true;
  return (
    <Tooltip content={reason} disabled={!shows} className={className}>
      {children}
    </Tooltip>
  );
}
