'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

const TASKS = [
  'VIDEO_ANALYSIS',
  'NARRATION_REWRITE',
  'METADATA',
  'IDEA_GENERATION',
  'BRIEF_GENERATION',
  'DRAMA_BIBLE',
  'DRAMA_EPISODE',
] as const;

const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-flash',
  'gpt-4o-mini',
  'gpt-4o',
] as const;

interface PlaygroundResult {
  output: unknown;
  model: string;
  cached?: boolean;
  usage: { tokensIn?: number; tokensOut?: number };
}

export default function PlaygroundPage() {
  const [task, setTask] = useState<string>(TASKS[0]);
  const [model, setModel] = useState<string>(MODELS[0]);
  const [system, setSystem] = useState('');
  const [input, setInput] = useState('');
  const [skipCache, setSkipCache] = useState(false);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setError(null);
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
      setError(err instanceof ApiError ? err.message : 'Playground request failed');
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none';

  return (
    <div>
      <h2 className="mb-1 text-lg font-medium text-slate-200">AI Playground</h2>
      <p className="mb-6 text-sm text-slate-400">
        Dry-run any AI task against the live provider chain. No results are persisted.
      </p>

      {error && (
        <p className="mb-4 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Input panel */}
        <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-slate-300">Task</span>
              <select value={task} onChange={(e) => setTask(e.target.value)} className={inputCls}>
                {TASKS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-slate-300">Model</span>
              <select value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-sm text-slate-300">System prompt (optional)</span>
            <textarea
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              rows={3}
              className={inputCls}
              placeholder="Override the default system prompt for this task..."
            />
          </label>

          <label className="block">
            <span className="text-sm text-slate-300">Input</span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={6}
              className={inputCls}
              placeholder="Enter your input text or JSON..."
            />
          </label>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={skipCache}
                onChange={(e) => setSkipCache(e.target.checked)}
              />
              Skip cache
            </label>
            <button
              onClick={run}
              disabled={busy || !input.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy ? 'Running…' : 'Run'}
            </button>
          </div>
        </section>

        {/* Output panel */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-300">Output</h3>
            {result && (
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>model: {result.model}</span>
                {result.cached && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">
                    cached
                  </span>
                )}
                {result.usage.tokensIn != null && <span>{result.usage.tokensIn} in</span>}
                {result.usage.tokensOut != null && <span>{result.usage.tokensOut} out</span>}
              </div>
            )}
          </div>
          {result ? (
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
              {typeof result.output === 'string'
                ? result.output
                : JSON.stringify(result.output, null, 2)}
            </pre>
          ) : (
            <p className="py-12 text-center text-sm text-slate-600">
              {busy ? 'Running…' : 'Run a task to see output here.'}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
