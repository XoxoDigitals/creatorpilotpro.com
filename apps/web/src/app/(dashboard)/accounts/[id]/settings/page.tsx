'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { getAccount } from '@/lib/mock-data';
import type { ContentType } from '@/lib/domain-types';

/** Channel Profile editor (FR-G). Values are local mock state until Phase 1. */
export default function AccountSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const account = getAccount(id);
  const toast = useToast();

  const [contentType, setContentType] = useState<ContentType>(account?.contentType ?? 'AI');
  const [dramasEnabled, setDramasEnabled] = useState(account?.dramasEnabled ?? false);
  const [masterPrompt, setMasterPrompt] = useState(
    'You write for a fast-paced short-form channel. Tone: energetic, plain language, hook in the first sentence…',
  );
  const [writingStyle, setWritingStyle] = useState('Short sentences. Concrete verbs. No filler.');
  const [narrationStyle, setNarrationStyle] = useState('Warm, medium pace, slight emphasis on numbers.');
  const [language, setLanguage] = useState('en');
  const [ttsProvider, setTtsProvider] = useState('kokoro');
  const [voice, setVoice] = useState('af_bella');
  const [titleTemplate, setTitleTemplate] = useState('{{hook}} — {{topic}}');
  const [tags, setTags] = useState('shorts, viral, daily');
  const [aiLabel, setAiLabel] = useState(true);
  const [scriptGate, setScriptGate] = useState(true);
  const [maxPerDay, setMaxPerDay] = useState('2');
  const [minGap, setMinGap] = useState('3');

  if (!account) return null;

  const save = () => toast('Channel profile saved (mock — persists in Phase 1)', 'success');

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader
          title="Content pipeline"
          description="Decides which workspace tabs and pipelines this account uses"
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Content type">
            <Select value={contentType} onChange={(e) => setContentType(e.target.value as ContentType)}>
              <option value="AI">AI content</option>
              <option value="REPURPOSED">Repurposed content</option>
              <option value="MIXED">Both (mixed)</option>
            </Select>
          </Field>
          <Field label="Language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="ur">Urdu</option>
              <option value="hi">Hindi</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Toggle
              checked={dramasEnabled}
              onChange={setDramasEnabled}
              label="Enable AI drama series (adds the Dramas tab to this account)"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Ideas generation is available on AI and Mixed accounts only; Dramas is this separate
              toggle and works on any account type.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Master prompt & styles"
          description="Injected into every AI task for this account — analysis, rewriting, metadata, ideas"
        />
        <div className="space-y-4 p-4">
          <Field label="Master prompt">
            <Textarea
              rows={5}
              value={masterPrompt}
              onChange={(e) => setMasterPrompt(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Writing style">
              <Textarea rows={3} value={writingStyle} onChange={(e) => setWritingStyle(e.target.value)} />
            </Field>
            <Field label="Narration / voiceover style">
              <Textarea
                rows={3}
                value={narrationStyle}
                onChange={(e) => setNarrationStyle(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Voice" description="Provider and voice used for generated voiceovers" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="TTS provider">
            <Select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)}>
              <option value="kokoro">Kokoro (self-hosted, free)</option>
              <option value="gemini">Gemini TTS</option>
              <option value="openai">OpenAI TTS</option>
            </Select>
          </Field>
          <Field label="Voice">
            <Input value={voice} onChange={(e) => setVoice(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Publish defaults" description="Applied to every post on this account" />
        <div className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title template">
              <Input value={titleTemplate} onChange={(e) => setTitleTemplate(e.target.value)} />
            </Field>
            <Field label="Default tags (comma-separated)">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
          </div>
          <Toggle
            checked={aiLabel}
            onChange={setAiLabel}
            label="Mark uploads as AI-generated content (platform disclosure)"
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Approval policy & throughput"
          description="Which gates are manual, and how fast this account publishes"
        />
        <div className="space-y-4 p-4">
          <Toggle
            checked={scriptGate}
            onChange={setScriptGate}
            label="Require manual approval of AI-rewritten scripts before voiceover"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Max posts per day">
              <Input type="number" min={1} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
            </Field>
            <Field label="Minimum gap between posts (hours)">
              <Input type="number" min={0} value={minGap} onChange={(e) => setMinGap(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button onClick={() => toast('Changes discarded', 'info')}>Discard</Button>
        <Button variant="primary" onClick={save}>
          Save channel profile
        </Button>
      </div>
    </div>
  );
}
