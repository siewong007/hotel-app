import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TableScroll } from './TableScroll';

const table = (
  <table>
    <tbody>
      <tr>
        <td>Deluxe</td>
        <td>$250</td>
      </tr>
    </tbody>
  </table>
);

describe('TableScroll', () => {
  afterEach(cleanup);

  it('scrolls horizontally without pinning a column by default', () => {
    const { container } = render(<TableScroll>{table}</TableScroll>);
    expect(getComputedStyle(container.firstElementChild as HTMLElement).overflowX).toBe('auto');
    expect(getComputedStyle(container.querySelector('td') as HTMLElement).position).not.toBe('sticky');
  });

  it('stickyFirstColumn pins only the first cell of each row', () => {
    const { container } = render(<TableScroll stickyFirstColumn>{table}</TableScroll>);
    const [first, second] = Array.from(container.querySelectorAll('td'));
    expect(getComputedStyle(first).position).toBe('sticky');
    expect(getComputedStyle(first).left).toBe('0px');
    expect(getComputedStyle(second).position).not.toBe('sticky');
  });
});
