'use client';

import {
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

  return (
    <div className="space-y-5">
      <p className="text-xs text-zinc-500">
        Answer these to shape ideas, scripts, and other AI tasks for this account. Then paste
        animation guidelines and click Generate prompt.
      </p>

      {STYLE_QUESTIONS.map((q) => (
        <div key={q.id} className="space-y-1.5">
          <div>
            <p className="text-xs font-medium text-zinc-700">
              {q.label}
              {q.required ? <span className="text-rose-500"> *</span> : null}
            </p>
            {q.help ? <p className="mt-0.5 text-[11px] text-zinc-500">{q.help}</p> : null}
          </div>
          {q.type === 'text' ? (
            <Textarea
              rows={2}
              placeholder={q.placeholder}
              value={(answers[q.id] as string) ?? ''}
              onChange={(e) => setText(q.id, e.target.value)}
            />
          ) : q.type === 'multi' ? (
            <OptionChips
              question={q}
              selected={(answers[q.id] as string[]) ?? []}
              onToggle={(v) => toggleMulti(q.id, v)}
            />
          ) : (
            <OptionChips
              question={q}
              selected={answers[q.id] ? [answers[q.id] as string] : []}
              onToggle={(v) => setSingle(q.id, v)}
            />
          )}
        </div>
      ))}

      <Field label="Animation prompt guidelines">
        <Textarea
          rows={6}
          value={animationReferencePrompt}
          onChange={(e) => onAnimationReferenceChange(e.target.value)}
          placeholder="Paste your animationPrompt guidelines here (camera moves, motion rules, style DNA, do/don’t list…). Package generation will apply these to every scene animationPrompt."
          className="font-mono text-[11px] leading-relaxed"
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Saved on the channel profile and injected into scene video/animation prompts.
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
          <p className="mb-2 text-xs font-medium text-zinc-700">Master prompt</p>
          <Textarea
            rows={10}
            value={masterPrompt}
            onChange={(e) => {
              onOverrideChange(true);
              onMasterPromptChange(e.target.value);
            }}
            className="bg-white font-mono text-[11px] leading-relaxed"
          />
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Edit after generate if needed. Save the channel profile to persist.
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
