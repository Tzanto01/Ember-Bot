import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PageComponent } from '../../shared/page';

/** Placeholder; run 2 replaces it. */
@Component({
  selector: 'app-imprint-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageComponent],
  template: `<app-page heading="Imprint" />`,
})
export class ImprintPage {}
