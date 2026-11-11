import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from './form-field';

describe('FormField', () => {
  it('marks a required control for assistive tech and announces its error', () => {
    render(
      <FormField label="Name" error="Please fill this in.">
        {(field) => <input {...field} />}
      </FormField>,
    );

    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Please fill this in.');
    expect(input).toHaveAccessibleDescription('Please fill this in.');
  });
});
