import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';
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
import { allowDeviceReminders, canAskDevice, DeviceRemindersOff } from '@/components/habits/device-reminders';
import { ChannelChoices, phoneChoice } from '@/components/habits/habit-edit-sections';
import { HabitPreview } from '@/components/habits/habit-preview';
import { useReminderReach, useReminderSettingsHash } from '@/components/habits/reminder-reach';
import { PageHeader } from '@/components/page-header';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { env } from '@/lib/env';
import type { HabitTemplate, NewHabit } from '@/lib/models';
import { asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { api, localMode } from '@/lib/services';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const nameId = 'habit-name';

/** `/habits/new`: pick a template (skipped when none load), then the habit form; "Create habit" lands on `/today`. */
export default function HabitNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const templates = useQuery({ queryKey: ['habit-templates'], queryFn: () => api.listTemplates(), retry: false });
  const [chosen, setChosen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [form, setForm] = useState(emptyHabitForm);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<FriendlyProblem | null>(null);
  const submitting = useRef(false);
  const reach = useReminderReach();
  const reminderHash = useReminderSettingsHash();
  const reminders = reach !== 'local';
  const localPhone = useStore(localMode.mode) === 'local' && env.native;
  const [phoneOn, setPhoneOn] = useState(true);
  const [createdOff, setCreatedOff] = useState(false);
  const offRef = useRef<HTMLDivElement>(null);
  const silent = localPhone && !phoneOn;

  const create = useMutation({
    mutationFn: async ({ body, ask }: { body: NewHabit; ask: boolean }) => {
      const allowed = ask ? await allowDeviceReminders() : true;
      await api.createHabit(body);
      return allowed;
    },
    onSuccess: (allowed) => {
      if (allowed) {
        void navigate('/today');
        return;
      }
      flushSync(() => setCreatedOff(true));
      offRef.current?.focus();
    },
    onError: (error) => {
      submitting.current = false;
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
              reminderTimes: [template.suggestedReminderTime],
            }
          : emptyHabitForm,
      );
      setTouched(false);
      setPicked(template?.name ?? null);
      setPhoneOn(true);
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
    if (submitting.current) return;
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
    if (reminders) {
      if (localPhone) body.reminderChannels = phoneOn ? ['mobile'] : [];
      if (value.reminderTimes.length && !silent) body.reminderTimes = value.reminderTimes;
    }
    submitting.current = true;
    setProblem(null);
    create.mutate({ body, ask: !!body.reminderTimes && canAskDevice() });
  }

  const preview = habitFormValue(form);
  const lede = showForm
    ? picked
      ? t('habitNew.basedOn', { name: picked })
      : t('habitNew.keepSmall')
    : t('habitNew.pick');

  return (
    <div ref={root} className="flex flex-col gap-6">
      <PageHeader title={t('habitNew.title')} lede={lede} />

      {!showForm && !templates.data && (
        <div className="grid gap-3 md:grid-cols-2">
          <p role="status" className="sr-only">
            {t('habitNew.loading')}
          </p>
          {[1, 2, 3, 4].map((n) => (
            <Skeleton key={n} className="h-[7rem] rounded-xl" />
          ))}
        </div>
      )}

      {!showForm && templates.data && (
        <>
          <Button type="button" variant="secondary" block onClick={() => startForm(null)}>
            <Plus aria-hidden />
            {t('habitNew.scratch')}
          </Button>
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
                    {reminders
                      ? t('habitNew.cadenceReminder', {
                          cadence: cadenceText(template.frequency, template.weeklyTarget),
                          time: template.suggestedReminderTime,
                        })
                      : cadenceText(template.frequency, template.weeklyTarget)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {createdOff && (
        <Card ref={offRef} tabIndex={-1} className="w-full max-w-[36rem] focus:outline-none">
          <p className="font-semibold">{t('habitNew.ready')}</p>
          <DeviceRemindersOff />
          <Button block asChild>
            <Link to="/today">{t('habitNew.goToday')}</Link>
          </Button>
        </Card>
      )}

      {showForm && !createdOff && (
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
                showReminder={reminders}
                silent={silent}
                reminderNote={
                  reach === 'none' && (
                    <Trans
                      t={t}
                      i18nKey="habitNew.reachNote"
                      components={{ anchor: <Link to={{ pathname: '/settings', hash: reminderHash }} /> }}
                    />
                  )
                }
              />
              {localPhone && (
                <div className="-mt-3 flex flex-col gap-2">
                  <p className="font-medium">{t('habitNew.howReminds')}</p>
                  <ChannelChoices
                    options={phoneChoice}
                    current={phoneOn ? ['mobile'] : []}
                    idPrefix="new-channel"
                    onToggle={(_, checked) => setPhoneOn(checked)}
                  />
                </div>
              )}
              {problem && <Notice tone="notice">{problem.message}</Notice>}
              <div className="flex flex-col gap-3">
                <Button type="submit" block aria-disabled={create.isPending || undefined}>
                  {create.isPending ? (
                    <>
                      <Spinner />
                      {t('habitNew.creating')}
                    </>
                  ) : (
                    t('habitNew.create')
                  )}
                </Button>
                {hasTemplates && (
                  <Button type="button" variant="ghost" block onClick={backToSuggestions}>
                    {t('habitNew.back')}
                  </Button>
                )}
                <Button variant="ghost" block asChild>
                  <Link to="/today">{t('habitNew.cancel')}</Link>
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
