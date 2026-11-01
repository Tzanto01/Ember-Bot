import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageComponent } from '../../shared/page';

@Component({
  selector: 'app-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageComponent, RouterLink],
  template: `
    <app-page heading="This page wandered off" lede="The link may be old, or the address has a small typo. Nothing is lost.">
      <a class="btn btn-primary btn-block" routerLink="/today">Go to Today</a>
    </app-page>
  `,
})
export class NotFoundPage {}
