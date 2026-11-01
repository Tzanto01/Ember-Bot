import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LegalDocumentComponent } from './legal-document';

@Component({
  selector: 'app-imprint-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LegalDocumentComponent],
  template: `<app-legal-document file="impressum.md" fallbackHeading="Imprint" />`,
})
export class ImprintPage {}
