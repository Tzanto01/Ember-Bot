import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PageComponent } from '../../shared/page';

/** Placeholder; run 2 replaces it. */
@Component({
  selector: 'app-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageComponent],
  template: `<app-page heading="Terms" />`,
})
export class TermsPage {}
