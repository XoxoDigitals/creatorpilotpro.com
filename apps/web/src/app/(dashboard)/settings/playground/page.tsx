'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

const TASKS = [
  'VIDEO_ANALYSIS',
  'NARRATION_REWRITE',
  'METADATA',
  'AB_SUGGESTIONS',
  'IDEA_GENERATION',
  'BRIEF_GENERATION',
  'DRAMA_BIBLE',
  'DRAMA_EPISODE',
] as const;

const MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gpt-4o-mini',
  'gpt-4o',
] as const;

interface PlaygroundResult {
  output: unknown;
  model: string;
  cached?: boolean;
  usage: { tokensIn?: number; tokensOut?: number };
}

interface PromptVersion {
  id: string;
  accountId: string | null;
  task: string;
  name: string;
  version: number;
  template: string;
  isActive: boolean;
  createdAt: string;
}

export default function PlaygroundPage() {
  const toast = useToast();
  const [task, setTask] = useState<string>(TASKS[0]);
  const [model, setModel] = useState<string>(MODELS[0]);
  const [system, setSystem] = useState('');
  const [input, setInput] = useState('');
  const [skipCache, setSkipCache] = useState(false);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Prompt version library
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [promptName, setPromptName] = useState('default');
  const [savingPrompt, setSavingPrompt] = useState(false);

  const loadPrompts = useCallback(async () => {
    try {
      const list = await api.get<PromptVersion[]>(`/ai/prompts?task=${task}&accountId=null`);
      setPrompts(list);
      // Auto-load the active prompt if present + system is empty.
      const active = list.find((p) => p.isActive);
      if (active && !system) {
        setSystem(active.template);
        setPromptName(active.name);
      }
    } catch {
      // silent — prompt store might be empty
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  useEffect(() => { void loadPrompts(); }, [loadPrompts]);

  async function run() {
    setResult(null);
    setBusy(true);
    try {
      const res = await api.post<PlaygroundResult>('/ai/playground', {
        task,
        model,
        system: system || undefined,
        input,
        skipCache,
      });
      setResult(res);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Playground request failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveAsPrompt() {
    if (!system.trim() || !promptName.trim()) {
      toast('Enter a system prompt and a name', 'info');
      return;
    }
    setSavingPrompt(true);
    try {
      await api.post('/ai/prompts', {
        accountId: null,
        task,
        name: promptName.trim(),
        template: system,
      });
      toast('Saved as new prompt version', 'success');
      await loadPrompts();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Save failed', 'error');
    } finally {
      setSavingPrompt(false);
    }
  }

  async function activatePrompt(id: string) {
    try {
      await api.patch(`/ai/prompts/${id}/active`, { isActive: true });
      toast('Prompt activated', 'success');
      await loadPrompts();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Activation failed', 'error');
    }
  }

  function applyTemplate(p: PromptVersion) {
    setSystem(p.template);
    setPromptName(p.name);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="AI Playground"
          description="Dry-run any task against the live provider chain. Save winning system prompts as versioned templates."
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: composer */}
        <Card className="p-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Task">
                <Select value={task} onChange={(e) => setTask(e.target.value)}>
                  {TASKS.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Model">
                <Select value={model} onChange={(e) => setModel(e.target.value)}>
                  {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="System prompt">
              <Textarea
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                rows={8}
                placeholder={`You are an AI assistant. Task: ${task}. Return output in JSON...`}
              />
            </Field>

            <Field label="Input">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={5}
                placeholder="Enter your input text or JSON..."
              />
            </Field>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={skipCache}
                  onChange={(e) => setSkipCache(e.target.checked)}
                />
                Skip cache
              </label>
              <Button variant="primary" size="sm" onClick={run} disabled={busy || !input.trim()}>
                {busy ? 'Running…' : 'Run'}
              </Button>
            </div>

            {/* Save-as-prompt row */}
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <p className="mb-2 text-xs font-medium text-zinc-700">Save this system prompt as a versioned template</p>
              <div className="flex gap-2">
                <Input
                  value={promptName}
                  onChange={(e) => setPromptName(e.target.value)}
                  placeholder="Prompt name (e.g., default, aggressive-hook)"
                />
                <Button size="sm" onClick={saveAsPrompt} disabled={savingPrompt || !system.trim()}>
                  {savingPrompt ? 'Saving…' : 'Save version'}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                Saved prompts land in the library on the right. Activating one makes it the default the worker uses for this task.
              </p>
            </div>
          </div>
        </Card>

        {/* Right: output + library */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-700">Output</h3>
              {result && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>{result.model}</span>
                  {result.cached && <Badge tone="green">cached</Badge>}
                  {result.usage.tokensIn != null && <span>{result.usage.tokensIn} in</span>}
                  {result.usage.tokensOut != null && <span>{result.usage.tokensOut} out</span>}
                </div>
              )}
            </div>
            {result ? (
              <pre className="max-h-[45vh] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-800">
                {typeof result.output === 'string'
                  ? result.output
                  : JSON.stringify(result.output, null, 2)}
              </pre>
            ) : (
              <p className="py-8 text-center text-sm text-zinc-400">
                {busy ? 'Running…' : 'Run a task to see output.'}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title={`Prompt library — ${task}`} description="Versioned system prompts for this task" />
            <div className="max-h-[35vh] divide-y divide-zinc-100 overflow-auto">
              {prompts.length === 0 ? (
                <p className="p-4 text-xs text-zinc-500">No saved prompts yet for this task.</p>
              ) : prompts.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900">{p.name}</span>
                      <span className="text-[11px] text-zinc-400">v{p.version}</span>
                      {p.isActive && <Badge tone="green">active</Badge>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{p.template.slice(0, 200)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => applyTemplate(p)}
                      className="rounded px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
                    >
                      Use
                    </button>
                    {!p.isActive && (
                      <button
                        onClick={() => activatePrompt(p.id)}
                        className="rounded px-2 py-0.5 text-[11px] font-medium text-green-700 hover:bg-green-50"
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
