import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PageComponent } from '../../shared/page';

/** Placeholder; run 2 replaces it. */
@Component({
  selector: 'app-privacy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageComponent],
  template: `<app-page heading="Privacy" />`,
})
export class PrivacyPage {}
