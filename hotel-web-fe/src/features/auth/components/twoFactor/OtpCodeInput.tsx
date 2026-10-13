import React, { useId, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { sanitizeTotpCode, TOTP_CODE_LENGTH } from '../../utils/twoFactorCode';

const ACTIVE_CELL_RING = '0 0 0 3px var(--hotel-focus-ring, rgba(201, 169, 106, .55))';

export interface OtpCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired with the code once six digits are in — typed, pasted or autofilled. */
  onComplete?: (value: string) => void;
  label: string;
  helperText?: string;
  /** Marks the field invalid for assistive tech and outlines it. */
  invalid?: boolean;
  /** id of the element describing a current error, if any. */
  errorId?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * The six-digit authenticator code input: ONE native `<input>` drawn as six
 * boxes, not six inputs. A single field is what SMS/one-time-code autofill,
 * password managers, paste, and screen readers all expect — six inputs break
 * each of them in some browser — and it is one element to re-render.
 *
 * The real input sits transparently over the boxes (which are `aria-hidden`
 * and purely visual), so tapping anywhere on the row focuses it and the
 * platform keyboard, caret and paste menu behave natively.
 */
const OtpCodeInput: React.FC<OtpCodeInputProps> = ({
  value,
  onChange,
  onComplete,
  label,
  helperText,
  invalid = false,
  errorId,
  disabled = false,
  autoFocus = false,
  inputRef,
}) => {
  const id = useId();
  const helpId = `${id}-help`;
  const [focused, setFocused] = useState(false);
  const activeIndex = Math.min(value.length, TOTP_CODE_LENGTH - 1);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = sanitizeTotpCode(event.target.value);
    onChange(next);
    if (next.length === TOTP_CODE_LENGTH && next !== value) {
      onComplete?.(next);
    }
  };

  const describedBy = [errorId, helperText ? helpId : undefined].filter(Boolean).join(' ');

  return (
    <Box>
      <Typography
        component="label"
        htmlFor={id}
        variant="body2"
        sx={{ display: 'block', mb: 1, fontWeight: 600, color: 'var(--hotel-text)' }}
      >
        {label}
      </Typography>
      <Box
        className="otp-code"
        sx={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: `repeat(${TOTP_CODE_LENGTH}, minmax(0, 1fr))`,
          gap: { xs: 1, sm: 1.25 },
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {Array.from({ length: TOTP_CODE_LENGTH }, (_, index) => {
          const isActive = focused && !disabled && index === activeIndex;
          return (
            <Box
              key={index}
              aria-hidden="true"
              data-testid="otp-cell"
              sx={{
                height: { xs: 56, sm: 60 },
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '12px',
                border: '1px solid',
                borderColor: invalid
                  ? 'error.main'
                  : isActive
                    ? 'var(--hotel-primary)'
                    : 'var(--hotel-border, #2A3242)',
                boxShadow: isActive ? ACTIVE_CELL_RING : 'none',
                bgcolor: 'var(--hotel-surface-sunken)',
                fontSize: { xs: '1.5rem', sm: '1.625rem' },
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--hotel-text)',
                transition: 'border-color 120ms, box-shadow 120ms',
              }}
            >
              {value[index] ?? ''}
            </Box>
          );
        })}
        <Box
          component="input"
          id={id}
          ref={inputRef}
          name="one-time-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          enterKeyHint="done"
          maxLength={TOTP_CODE_LENGTH}
          // Autofocus is the point of this step: the user just pressed Login
          // and the code is the only thing left to type.
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            m: 0,
            p: 0,
            border: 0,
            outline: 'none',
            background: 'transparent',
            // Invisible text and caret: the boxes draw the digits. 16px keeps
            // iOS Safari from zooming the page on focus.
            color: 'transparent',
            caretColor: 'transparent',
            fontSize: '16px',
            letterSpacing: 0,
            cursor: 'text',
            '&::selection': { background: 'transparent' },
            // The cells carry the focus ring; suppress the card-wide one.
            '&:focus-visible': { outline: 'none' },
          }}
        />
      </Box>
      {helperText && (
        <Typography
          id={helpId}
          variant="caption"
          sx={{ display: 'block', mt: 1, color: 'var(--hotel-text-secondary)' }}
        >
          {helperText}
        </Typography>
      )}
    </Box>
  );
};

export default OtpCodeInput;
