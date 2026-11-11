import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TodaysEmber } from './todays-ember';

describe('TodaysEmber', () => {
  it('says nothing is checked in yet at zero on an ordinary day', () => {
    render(<TodaysEmber count={0} lowDay={false} stepping={false} />);

    expect(screen.getByText('Nothing checked in yet today')).toBeInTheDocument();
  });
});
