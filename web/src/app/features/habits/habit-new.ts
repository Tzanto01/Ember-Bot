import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PageComponent } from '../../shared/page';

/** Placeholder; run 2 replaces it. */
@Component({
  selector: 'app-habit-new-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageComponent],
  template: `<app-page heading="New habit" />`,
})
export class HabitNewPage {}
