import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { lexer, parser, Tokens } from 'marked';
import { firstValueFrom } from 'rxjs';
import { IconComponent } from '../../shared/icon';
import { NoticeComponent } from '../../shared/notice';
import { PageComponent } from '../../shared/page';

/** Renders a legal text from `/legal/<file>` (German markdown). Its first `#` heading becomes the page heading. */
@Component({
  selector: 'app-legal-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterLink, PageComponent, NoticeComponent, IconComponent],
  template: `
    <app-page [heading]="heading()" [attr.lang]="html() ? 'de' : null">
      @if (html(); as html) {
        <div class="legal-prose" [innerHTML]="html"></div>
      } @else if (failed()) {
        <app-notice tone="notice"
          >This page couldn't be loaded. Check your connection and try again.</app-notice
        >
        <div class="row">
          <button class="btn btn-secondary" type="button" (click)="load()">Try again</button>
        </div>
      } @else {
        <div class="stack" aria-busy="true">
          <span class="visually-hidden" role="status">Loading…</span>
          <div class="skeleton legal-line"></div>
          <div class="skeleton legal-line"></div>
          <div class="skeleton legal-line legal-short"></div>
        </div>
      }
      <p lang="en">
        <a class="tap-link legal-back" routerLink="/"
          ><app-icon name="arrow-left" />Back to Ember</a
        >
      </p>
    </app-page>
  `,
  styles: `
    .legal-prose {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      max-width: var(--measure);
    }
    .legal-prose h2 {
      margin-top: var(--space-4);
    }
    .legal-prose ul,
    .legal-prose ol {
      margin: 0;
      padding-inline-start: var(--space-5);
    }
    .legal-prose li + li {
      margin-top: var(--space-1);
    }
    .legal-prose blockquote {
      margin: 0;
      padding: var(--space-3) var(--space-4);
      border-inline-start: 3px solid var(--color-border-strong);
      border-radius: var(--radius-sm);
      background: var(--color-surface-sunken);
    }
    .legal-prose hr {
      width: 100%;
      margin: 0;
      border: 0;
      border-top: 1px solid var(--color-border);
    }
    .legal-prose table {
      display: block;
      overflow-x: auto;
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    .legal-prose th,
    .legal-prose td {
      padding: var(--space-2);
      border: 1px solid var(--color-border);
      text-align: start;
      vertical-align: top;
    }
    .legal-line {
      height: 1.25rem;
    }
    .legal-short {
      width: 60%;
    }
    .legal-back {
      gap: var(--space-2);
    }
  `,
})
export class LegalDocumentComponent implements OnInit {
  private readonly http = inject(HttpClient);

  /** File name under `/legal/`, for example `impressum.md`. */
  readonly file = input.required<string>();
  /** Heading shown until the document's own `#` heading is loaded. */
  readonly fallbackHeading = input.required<string>();

  protected readonly html = signal<string | null>(null);
  protected readonly failed = signal(false);
  private readonly docHeading = signal<string | null>(null);
  protected readonly heading = computed(() => this.docHeading() ?? this.fallbackHeading());

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.failed.set(false);
    try {
      const markdown = await firstValueFrom(
        this.http.get(`/legal/${this.file()}`, { responseType: 'text' }),
      );
      if (/^\s*<!doctype/i.test(markdown)) throw new Error('Expected markdown, got the app shell');
      const tokens = lexer(markdown, { gfm: true, breaks: true });
      const first = tokens[0] as Tokens.Heading | undefined;
      if (first?.type === 'heading' && first.depth === 1) {
        this.docHeading.set(first.text);
        tokens.shift();
      }
      this.html.set(parser(tokens, { gfm: true, breaks: true }));
    } catch {
      this.failed.set(true);
    }
  }
}
