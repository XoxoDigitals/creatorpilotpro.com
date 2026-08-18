'use client';

import { useRef, useState } from 'react';
import {
  LOCKED_CHARACTER_LOOKS,
  LOCKED_CHARACTER_LOOK_LABELS,
  STYLE_QUESTION_SECTIONS,
  STYLE_QUESTIONS,
  emptyLockedCharacter,
  emptyStyleProfileAnswers,
  parseStyleProfile,
  type LockedCharacter,
  type LockedCharacterLook,
  type StyleProfile,
  type StyleProfileAnswers,
  type StyleQuestion,
} from '@scp/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { ApiError, api, apiUpload } from '@/lib/api';

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
              'rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
              opt.hint ? 'max-w-[18rem]' : '',
              active
                ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50',
            )}
          >
            <span className="block font-medium leading-snug">{opt.label}</span>
            {opt.hint ? (
              <span className="mt-0.5 block text-[10px] font-normal leading-snug text-zinc-500">
                {opt.hint}
              </span>
            ) : null}
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

function defaultLookForAnswers(answers: StyleProfileAnswers): LockedCharacterLook {
  if (answers.visualStyles.includes('2d_cartoon') || answers.animationStyle === '2d_cartoon') {
    return 'cartoon_2d';
  }
  if (answers.visualStyles.includes('3d_cartoon') || answers.animationStyle === '3d_cartoon') {
    return 'cartoon_3d';
  }
  return 'ultra_realistic';
}

function CharacterLockEditor({
  accountId,
  characters,
  answers,
  onChange,
}: {
  accountId?: string;
  characters: LockedCharacter[];
  answers: StyleProfileAnswers;
  onChange: (next: LockedCharacter[]) => void;
}) {
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function update(index: number, patch: Partial<LockedCharacter>) {
    onChange(characters.map((character, i) => (i === index ? { ...character, ...patch } : character)));
  }

  async function uploadImage(index: number, file: File) {
    if (!accountId) {
      setUploadError('Save the channel first, then upload a character image.');
      return;
    }
    setUploadError(null);
    setUploadingIndex(index);
    try {
      const next = await apiUpload<{
        profile?: { styleProfile?: unknown };
      }>(`/accounts/${accountId}/locked-characters/${index}/image`, file);
      const fromProfile = parseStyleProfile(next.profile?.styleProfile);
      if (fromProfile.lockedCharacters.length) {
        onChange(fromProfile.lockedCharacters);
      }
    } catch (err) {
      setUploadError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not upload that image.',
      );
    } finally {
      setUploadingIndex(null);
    }
  }

  async function clearImage(index: number) {
    if (!accountId) return;
    setUploadError(null);
    setUploadingIndex(index);
    try {
      const next = await api.del<{
        profile?: { styleProfile?: unknown };
      }>(`/accounts/${accountId}/locked-characters/${index}/image`);
      const fromProfile = parseStyleProfile(next.profile?.styleProfile);
      if (fromProfile.lockedCharacters.length) {
        onChange(fromProfile.lockedCharacters);
      } else {
        update(index, { imagePath: '', imageFileName: '', imageMimeType: '' });
      }
    } catch (err) {
      setUploadError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not remove that image.',
      );
    } finally {
      setUploadingIndex(null);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
      <div>
        <p className="text-xs font-medium text-zinc-800">Character lock</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          Same face, body, and wardrobe in every video. Upload a reference still for each character,
          then preview or download from the Characters tab. Save after adding a character before
          uploading.
        </p>
      </div>
      {characters.map((character, index) => (
        <div key={index} className="space-y-2 rounded-md border border-zinc-200 bg-white p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-zinc-600">Character {index + 1}</p>
            <button
              type="button"
              className="text-[11px] text-rose-600 hover:text-rose-800"
              onClick={() => onChange(characters.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <Field label="Name">
            <Input
              value={character.name}
              onChange={(e) => update(index, { name: e.target.value })}
              placeholder="e.g. Hina"
            />
          </Field>
          <div>
            <p className="mb-1 text-[11px] font-medium text-zinc-600">Look</p>
            <div className="flex flex-wrap gap-1.5">
              {LOCKED_CHARACTER_LOOKS.map((look) => {
                const active = character.look === look;
                return (
                  <button
                    key={look}
                    type="button"
                    onClick={() => update(index, { look })}
                    className={cn(
                      'rounded-md border px-2 py-1 text-[11px]',
                      active
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300',
                    )}
                  >
                    {LOCKED_CHARACTER_LOOK_LABELS[look]}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Appearance (face, body, hair)">
            <Textarea
              rows={2}
              value={character.appearance}
              onChange={(e) => update(index, { appearance: e.target.value })}
              placeholder="e.g. 24-year-old woman, round face, short black hair, warm brown eyes"
            />
          </Field>
          <Field label="Wardrobe">
            <Textarea
              rows={2}
              value={character.wardrobe}
              onChange={(e) => update(index, { wardrobe: e.target.value })}
              placeholder="e.g. Cozy knit sweater with a denim apron"
            />
          </Field>
          <Field label="Age (optional)">
            <Input
              value={character.age}
              onChange={(e) => update(index, { age: e.target.value })}
              placeholder="e.g. 24"
            />
          </Field>
          <Field label="Lock notes (optional)">
            <Textarea
              rows={2}
              value={character.consistencyDetails}
              onChange={(e) => update(index, { consistencyDetails: e.target.value })}
              placeholder="e.g. Same mole on left cheek, never change haircut"
            />
          </Field>
          <div className="space-y-1.5 rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-2">
            <p className="text-[11px] font-medium text-zinc-600">Character image</p>
            {character.imagePath ? (
              <div className="flex flex-wrap items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/v1/accounts/${accountId}/locked-characters/${index}/image?t=${encodeURIComponent(character.imagePath)}`}
                  alt={character.name || `Character ${index + 1}`}
                  className="h-16 w-16 rounded object-cover border border-zinc-200 bg-white"
                />
                <span className="text-[11px] text-zinc-500 truncate max-w-[12rem]">
                  {character.imageFileName || 'Uploaded'}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={uploadingIndex === index}
                  onClick={() => void clearImage(index)}
                >
                  Remove image
                </Button>
              </div>
            ) : null}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="block w-full text-[11px] text-zinc-600 file:mr-2 file:rounded file:border-0 file:bg-zinc-200 file:px-2 file:py-1 file:text-[11px]"
              disabled={!accountId || uploadingIndex === index}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void uploadImage(index, file);
              }}
            />
            <p className="text-[11px] text-zinc-500">
              {uploadingIndex === index
                ? 'Uploading…'
                : 'PNG/JPG/WebP. Save the character on this page first if upload fails.'}
            </p>
          </div>
        </div>
      ))}
      {uploadError ? <p className="text-[11px] text-rose-600">{uploadError}</p> : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange([
            ...characters,
            { ...emptyLockedCharacter(), look: defaultLookForAnswers(answers) },
          ])
        }
      >
        Add locked character
      </Button>
    </div>
  );
}

function CustomVisualStyleEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyzeFile(file: File) {
    setError(null);
    setAnalyzing(true);
    try {
      const res = await apiUpload<{ visualStyle: string }>('/ai/analyze-visual-style', file);
      const style = (res.visualStyle ?? '').trim();
      if (!style) throw new Error('AI returned an empty style.');
      onChange(style);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not analyze that video.',
      );
    } finally {
      setAnalyzing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
      <Field label="Write your own style">
        <Textarea
          rows={6}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe the exact look: 2D/3D/photoreal, color grade, camera, cut rhythm, graphics, motion beats, negatives… Or analyze a reference video and edit the result."
          className="bg-white font-mono text-[11px] leading-relaxed"
        />
      </Field>
      <p className="text-[11px] text-zinc-500">
        This overrides chip labels when they conflict. Saved with the questionnaire. Click Generate
        prompt after you write or analyze.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void analyzeFile(file);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={analyzing}
          onClick={() => fileRef.current?.click()}
        >
          {analyzing ? 'Analyzing video…' : 'Analyze with AI'}
        </Button>
        <span className="text-[11px] text-zinc-500">
          Upload a 20–90s reference clip. Uses the existing Gemini keys from Settings → AI.
        </span>
      </div>
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}

export function StyleQuestionnaire({
  accountId,
  answers,
  lockedCharacters,
  animationReferencePrompt,
  masterPrompt,
  writingStyle,
  narrationStyle,
  showAdvanced,
  generating = false,
  onAnswersChange,
  onLockedCharactersChange,
  onAnimationReferenceChange,
  onMasterPromptChange,
  onWritingStyleChange,
  onNarrationStyleChange,
  onOverrideChange,
  onShowAdvancedChange,
  onGeneratePrompt,
}: {
  accountId?: string;
  answers: StyleProfileAnswers;
  lockedCharacters: LockedCharacter[];
  animationReferencePrompt: string;
  masterPrompt: string;
  writingStyle: string;
  narrationStyle: string;
  showAdvanced: boolean;
  generating?: boolean;
  onAnswersChange: (next: StyleProfileAnswers) => void;
  onLockedCharactersChange: (next: LockedCharacter[]) => void;
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
            {section.id === 'visuals' ? (
              <>
                <CustomVisualStyleEditor
                  value={answers.customVisualStyle ?? ''}
                  onChange={(next) => onAnswersChange({ ...answers, customVisualStyle: next })}
                />
                {cartoonSelected ? (
                  <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] text-zinc-600">
                    Cartoon selected: lock character model sheets (face, wardrobe, palette) across
                    scenes and videos. Visual DNA will not forbid cartoon or anime.
                  </p>
                ) : answers.visualStyles.includes('ultra_realistic') ? (
                  <p className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] text-zinc-600">
                    Ultra realistic selected: every person prompt will include “ultra realistic”
                    and keep the same face if you lock characters below.
                  </p>
                ) : null}
                <CharacterLockEditor
                  accountId={accountId}
                  characters={lockedCharacters}
                  answers={answers}
                  onChange={onLockedCharactersChange}
                />
              </>
            ) : null}
          </section>
        );
      })}

      <Field label="Animation prompt guidelines">
        <Textarea
          rows={6}
          value={animationReferencePrompt}
          onChange={(e) => onAnimationReferenceChange(e.target.value)}
          placeholder="AI MOTION DNA (every clip): timed beats 0-2 / 2-4 / 4-6 / 6-8. Camera + subject motion on generated frames. No stock or live footage. Leave blank to seed 2D / 3D / fast-graphics DNA from your answers when you Generate."
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
  lockedCharacters: LockedCharacter[] = [],
): StyleProfile {
  return {
    version: 1,
    answers,
    masterPromptOverridden,
    lockedCharacters,
  };
}

export function answersFromProfile(raw: unknown): {
  answers: StyleProfileAnswers;
  masterPromptOverridden: boolean;
  lockedCharacters: LockedCharacter[];
} {
  const parsed = parseStyleProfile(raw);
  return {
    answers: parsed.answers ?? emptyStyleProfileAnswers(),
    masterPromptOverridden: parsed.masterPromptOverridden,
    lockedCharacters: parsed.lockedCharacters ?? [],
  };
}
