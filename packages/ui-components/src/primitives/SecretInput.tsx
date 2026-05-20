// Password input with a show/hide eye toggle. Used everywhere the auth tab
// captures a secret-shaped field (passwords, client secrets, tokens, JWT
// signing keys). Bare HTML <input type="password"> would do, but the eye
// toggle saves the user from blind typing of long tokens.

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from './cn';

interface SecretInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  id?: string;
}

export function SecretInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
  id,
}: SecretInputProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className={cn('relative flex w-full items-center', className)}>
      <input
        id={id}
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        className="h-8 w-full rounded-sm border border-border bg-card pl-2 pr-8 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
      />
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? `Hide ${ariaLabel}` : `Show ${ariaLabel}`}
        title={revealed ? 'Hide' : 'Show'}
        className="absolute right-1 inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-muted hover:text-text-primary"
      >
        {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </div>
  );
}
