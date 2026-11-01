import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LegalDocumentComponent } from './legal-document';

@Component({
  selector: 'app-terms-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LegalDocumentComponent],
  template: `<app-legal-document file="nutzungsbedingungen.md" fallbackHeading="Terms" />`,
})
export class TermsPage {}
