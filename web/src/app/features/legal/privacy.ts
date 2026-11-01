import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LegalDocumentComponent } from './legal-document';

@Component({
  selector: 'app-privacy-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LegalDocumentComponent],
  template: `<app-legal-document file="datenschutzerklaerung.md" fallbackHeading="Privacy" />`,
})
export class PrivacyPage {}
