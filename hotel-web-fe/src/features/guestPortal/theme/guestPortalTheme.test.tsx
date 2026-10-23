import { cleanup, render, screen } from '@testing-library/react';
import { Button, Step, StepLabel, Stepper } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it } from 'vitest';
import { createGuestPortalTheme } from './guestPortalTheme';

const GOLD = 'rgb(217, 181, 114)';
const INK = 'rgb(35, 27, 12)';

describe('guest portal brand theme', () => {
  afterEach(cleanup);

  it.each(['light', 'dark'] as const)('renders primary buttons as the landing gold pill with ink text (%s)', (mode) => {
    render(
      <ThemeProvider theme={createGuestPortalTheme(mode)}>
        <Button variant="contained">Search</Button>
        <Button>Back</Button>
      </ThemeProvider>,
    );
    const primary = getComputedStyle(screen.getByRole('button', { name: 'Search' }));
    expect(primary.backgroundColor).toBe(GOLD);
    expect(primary.color).toBe(INK);
    expect(primary.minHeight).toBe('44px');
    expect(getComputedStyle(screen.getByRole('button', { name: 'Back' })).minHeight).toBe('44px');
  });

  it('colours the active step gold', () => {
    const { container } = render(
      <ThemeProvider theme={createGuestPortalTheme('light')}>
        <Stepper activeStep={1}><Step><StepLabel>Search</StepLabel></Step><Step><StepLabel>Choose</StepLabel></Step></Stepper>
      </ThemeProvider>,
    );
    const active = container.querySelector('.MuiStepIcon-root.Mui-active')!;
    expect(getComputedStyle(active).color).toBe(GOLD);
  });
});
