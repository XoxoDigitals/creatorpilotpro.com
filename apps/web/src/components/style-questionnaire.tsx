'use client';

import {
  STYLE_QUESTION_SECTIONS,
  STYLE_QUESTIONS,
  emptyStyleProfileAnswers,
  parseStyleProfile,
  type StyleProfile,
  type StyleProfileAnswers,
  type StyleQuestion,
} from '@scp/shared';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';

function OptionChips({
  question,
  selected,
  onToggle,
}: {
  question: StyleQuestion;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(question.options ?? []).map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onToggle(opt.value)}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
              active
                ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function QuestionBlock({
  question,
  answers,
  onText,
  onToggleMulti,
  onSetSingle,
}: {
  question: StyleQuestion;
  answers: StyleProfileAnswers;
  onText: (id: keyof StyleProfileAnswers, value: string) => void;
  onToggleMulti: (id: keyof StyleProfileAnswers, value: string) => void;
  onSetSingle: (id: keyof StyleProfileAnswers, value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-xs font-medium text-zinc-700">
          {question.label}
          {question.required ? <span className="text-rose-500"> *</span> : null}
        </p>
        {question.help ? <p className="mt-0.5 text-[11px] text-zinc-500">{question.help}</p> : null}
      </div>
      {question.type === 'text' ? (
        <Textarea
          rows={2}
          placeholder={question.placeholder}
          value={(answers[question.id] as string) ?? ''}
          onChange={(e) => onText(question.id, e.target.value)}
        />
      ) : question.type === 'multi' ? (
        <OptionChips
          question={question}
          selected={(answers[question.id] as string[]) ?? []}
          onToggle={(v) => onToggleMulti(question.id, v)}
        />
      ) : (
        <OptionChips
          question={question}
          selected={answers[question.id] ? [answers[question.id] as string] : []}
          onToggle={(v) => onSetSingle(question.id, v)}
        />
      )}
    </div>
  );
}

const QUESTION_BY_ID = new Map(STYLE_QUESTIONS.map((q) => [q.id, q]));

export function StyleQuestionnaire({
  answers,
  animationReferencePrompt,
  masterPrompt,
  writingStyle,
  narrationStyle,
  showAdvanced,
  generating = false,
  onAnswersChange,
  onAnimationReferenceChange,
  onMasterPromptChange,
  onWritingStyleChange,
  onNarrationStyleChange,
  onOverrideChange,
  onShowAdvancedChange,
  onGeneratePrompt,
}: {
  answers: StyleProfileAnswers;
  animationReferencePrompt: string;
  masterPrompt: string;
  writingStyle: string;
  narrationStyle: string;
  showAdvanced: boolean;
  generating?: boolean;
  onAnswersChange: (next: StyleProfileAnswers) => void;
  onAnimationReferenceChange: (v: string) => void;
  onMasterPromptChange: (v: string) => void;
  onWritingStyleChange: (v: string) => void;
  onNarrationStyleChange: (v: string) => void;
  onOverrideChange: (overridden: boolean) => void;
  onShowAdvancedChange: (v: boolean) => void;
  onGeneratePrompt: () => void | Promise<void>;
}) {
  function setText(id: keyof StyleProfileAnswers, value: string) {
    onAnswersChange({ ...answers, [id]: value });
  }

  function toggleMulti(id: keyof StyleProfileAnswers, value: string) {
    const current = (answers[id] as string[]) ?? [];
    const nextVals = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onAnswersChange({ ...answers, [id]: nextVals });
  }

  function setSingle(id: keyof StyleProfileAnswers, value: string) {
    const current = answers[id] as string;
    const nextVal = current === value ? '' : value;
    onAnswersChange({ ...answers, [id]: nextVal });
  }

  const cartoonSelected =
    answers.visualStyles.includes('2d_cartoon') ||
    answers.visualStyles.includes('3d_cartoon') ||
    answers.animationStyle === '2d_cartoon' ||
    answers.animationStyle === '3d_cartoon';

  return (
    <div className="space-y-5">
      <p className="text-xs text-zinc-500">
        Start with audio mode, then niche, visuals, and story. Generate a structured master prompt
        you can edit — especially the hook engine and visual prompt DNA.
      </p>

      {STYLE_QUESTION_SECTIONS.map((section) => {
        const questions = section.questionIds
          .map((id) => QUESTION_BY_ID.get(id))
          .filter((q): q is StyleQuestion => Boolean(q));
        const isAudio = section.id === 'audio';
        return (
          <section
            key={section.id}
            className={cn(
              'space-y-3 rounded-lg border p-3',
              isAudio
                ? 'border-indigo-200 bg-indigo-50/40'
                : 'border-zinc-200 bg-white',
            )}
          >
            <div>
              <p className={cn('text-sm font-semibold', isAudio ? 'text-indigo-950' : 'text-zinc-900')}>
                {section.title}
              </p>
              {section.help ? (
                <p className="mt-0.5 text-[11px] text-zinc-500">{section.help}</p>
              ) : null}
            </div>
            {questions.map((q) => (
              <QuestionBlock
                key={q.id}
                question={q}
                answers={answers}
                onText={setText}
                onToggleMulti={toggleMulti}
                onSetSingle={setSingle}
              />
            ))}
            {isAudio && answers.presentation === 'mixed' ? (
              <p className="rounded-md border border-indigo-200 bg-white px-2.5 py-2 text-[11px] text-indigo-900">
                Generate VO only for narrator windows. After package gen, use the VO LAYUP TIMELINE
                in editing instructions to place audio vs dialogue-only clips (exact mm:ss ranges).
              </p>
            ) : null}
            {section.id === 'visuals' && cartoonSelected ? (
              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] text-zinc-600">
                Cartoon selected: lock character model sheets (face, wardrobe, palette) across scenes.
                Visual DNA will not forbid cartoon or anime.
              </p>
            ) : null}
          </section>
        );
      })}

      <Field label="Animation prompt guidelines">
        <Textarea
          rows={6}
          value={animationReferencePrompt}
          onChange={(e) => onAnimationReferenceChange(e.target.value)}
          placeholder="MOTION DNA (applied to every clip): timed beats 0-2 / 2-4 / 4-6 / 6-8 for ~8s. Camera + subject motion + graphic punches. Leave blank to seed fast-paced / 2D / 3D DNA from your answers when you Generate."
          className="font-mono text-[11px] leading-relaxed"
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Saved on the channel profile. Owner-pasted text is never overwritten. Empty → Generate
          seeds structured MOTION DNA from your visual/animation answers.
        </p>
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={generating}
          onClick={() => void onGeneratePrompt()}
        >
          {generating ? 'Generating…' : 'Generate prompt'}
        </Button>
        <span className="text-[11px] text-zinc-500">
          AI reads all channel settings (questionnaire, guidelines, language, templates, voice) and
          writes a detailed master brief plus default tags.
        </span>
      </div>

      {masterPrompt.trim() ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="mb-2 text-xs font-medium text-zinc-700">Structured master prompt (editable)</p>
          <Textarea
            rows={16}
            value={masterPrompt}
            onChange={(e) => {
              onOverrideChange(true);
              onMasterPromptChange(e.target.value);
            }}
            className="bg-white font-mono text-[11px] leading-relaxed"
          />
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Sections 2 (Hook & retention) and 3 (Visual prompt DNA) are meant to be customized.
            Save the channel profile to persist.
          </p>
        </div>
      ) : null}

      <div>
        <button
          type="button"
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          onClick={() => onShowAdvancedChange(!showAdvanced)}
        >
          {showAdvanced ? 'Hide advanced style fields' : 'Show advanced style fields'}
        </button>
        {showAdvanced ? (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Writing style">
              <Textarea
                rows={3}
                value={writingStyle}
                onChange={(e) => {
                  onOverrideChange(true);
                  onWritingStyleChange(e.target.value);
                }}
              />
            </Field>
            <Field label="Narration / voiceover style">
              <Textarea
                rows={3}
                value={narrationStyle}
                onChange={(e) => {
                  onOverrideChange(true);
                  onNarrationStyleChange(e.target.value);
                }}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function styleProfileFromState(
  answers: StyleProfileAnswers,
  masterPromptOverridden: boolean,
): StyleProfile {
  return {
    version: 1,
    answers,
    masterPromptOverridden,
  };
}

export function answersFromProfile(raw: unknown): {
  answers: StyleProfileAnswers;
  masterPromptOverridden: boolean;
} {
  const parsed = parseStyleProfile(raw);
  return {
    answers: parsed.answers ?? emptyStyleProfileAnswers(),
    masterPromptOverridden: parsed.masterPromptOverridden,
  };
}
