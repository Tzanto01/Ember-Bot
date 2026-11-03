import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { focusFirstInvalid } from '@/components/form-field';
import {
  cadenceText,
  emptyHabitForm,
  habitDaysError,
  HabitFields,
  habitFormValue,
  habitNameError,
} from '@/components/habits/habit-fields';
import { HabitPreview } from '@/components/habits/habit-preview';
import { PageHeader } from '@/components/page-header';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import type { HabitTemplate, NewHabit } from '@/lib/models';
import { asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';
import { cn } from '@/lib/utils';

const nameId = 'habit-name';

/** `/habits/new`: pick a template (skipped when none load), then the habit form; "Create habit" lands on `/today`. */
export default function HabitNewPage() {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const templates = useQuery({ queryKey: ['habit-templates'], queryFn: () => api.listTemplates(), retry: false });
  const [chosen, setChosen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [form, setForm] = useState(emptyHabitForm);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<FriendlyProblem | null>(null);

  const create = useMutation({
    mutationFn: (body: NewHabit) => api.createHabit(body),
    onSuccess: () => {
      void navigate('/today');
    },
    onError: (error) => {
      const apiError = asApiError(error);
      if (!apiError.handled) setProblem(problemToMessage(apiError));
    },
  });

  const hasTemplates = (templates.data?.length ?? 0) > 0;
  const showForm = chosen || templates.isError || templates.data?.length === 0;

  function startForm(template: HabitTemplate | null): void {
    flushSync(() => {
      setForm(
        template
          ? {
              ...emptyHabitForm,
              name: template.name,
              frequency: template.frequency,
              weeklyTarget: template.weeklyTarget ?? 3,
              reminderTime: template.suggestedReminderTime,
            }
          : emptyHabitForm,
      );
      setTouched(false);
      setPicked(template?.name ?? null);
      setProblem(null);
      setChosen(true);
    });
    document.getElementById(nameId)?.focus();
  }

  function backToSuggestions(): void {
    flushSync(() => {
      setProblem(null);
      setChosen(false);
    });
    root.current?.querySelector<HTMLElement>('h1')?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (create.isPending) return;
    flushSync(() => setTouched(true));
    if (habitNameError(form.name) || habitDaysError(form)) {
      focusFirstInvalid(root.current);
      return;
    }
    const value = habitFormValue(form);
    const body: NewHabit = { name: value.name, frequency: value.frequency };
    if (value.days !== null) body.days = value.days;
    if (value.frequency !== 'weekly') body.timesPerDay = value.timesPerDay;
    if (value.weeklyTarget !== null) body.weeklyTarget = value.weeklyTarget;
    if (value.reminderTime) body.reminderTime = value.reminderTime;
    setProblem(null);
    create.mutate(body);
  }

  const preview = habitFormValue(form);
  const lede = showForm
    ? picked
      ? `Based on ${picked}. Adjust anything you like.`
      : 'Keep it small. Small is how habits start.'
    : 'Pick a starting point, or begin from scratch. You can change everything later.';

  return (
    <div ref={root} className="flex flex-col gap-6">
      <PageHeader title="New habit" lede={lede} />

      {!showForm && !templates.data && (
        <div className="grid gap-3 md:grid-cols-2">
          <p role="status" className="sr-only">
            Loading suggestions…
          </p>
          {[1, 2, 3, 4].map((n) => (
            <Skeleton key={n} className="h-[7rem] rounded-xl" />
          ))}
        </div>
      )}

      {!showForm && templates.data && (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {templates.data.map((template) => (
              <li key={template.key} className="flex">
                <button
                  type="button"
                  onClick={() => startForm(template)}
                  className={cn(
                    cardVariants(),
                    'w-full cursor-pointer gap-1 text-left transition-colors duration-[var(--ember-dur-fast)] ease-ember hover:border-ring focus-visible:border-ring',
                  )}
                >
                  <span className="font-display text-[18px]">{template.name}</span>
                  <span className="text-muted-foreground">{template.description}</span>
                  <span className="text-[14px] text-muted-foreground">
                    {cadenceText(template.frequency, template.weeklyTarget)} · reminder at{' '}
                    {template.suggestedReminderTime}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" block onClick={() => startForm(null)}>
            <Plus aria-hidden />
            Start from scratch
          </Button>
        </>
      )}

      {showForm && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,36rem)_18rem] lg:items-start">
          <Card className="w-full max-w-[36rem]">
            <form noValidate onSubmit={submit} className="flex flex-col gap-6">
              <HabitFields
                value={form}
                onChange={setForm}
                touched={touched}
                onTouched={() => setTouched(true)}
                errors={problem?.fields ?? {}}
                nameId={nameId}
              />
              {problem && <Notice tone="notice">{problem.message}</Notice>}
              <div className="flex flex-col gap-3">
                <Button type="submit" block aria-disabled={create.isPending || undefined}>
                  {create.isPending ? (
                    <>
                      <Spinner />
                      Creating your habit…
                    </>
                  ) : (
                    'Create habit'
                  )}
                </Button>
                {hasTemplates && (
                  <Button type="button" variant="ghost" block onClick={backToSuggestions}>
                    Back to suggestions
                  </Button>
                )}
                <Button variant="ghost" block asChild>
                  <Link to="/today">Cancel</Link>
                </Button>
              </div>
            </form>
          </Card>
          <HabitPreview
            className="hidden lg:flex"
            name={form.name}
            cadence={cadenceText(preview.frequency, preview.weeklyTarget, preview.days, preview.timesPerDay)}
          />
        </div>
      )}
    </div>
  );
}
