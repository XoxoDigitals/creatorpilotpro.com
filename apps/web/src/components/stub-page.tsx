interface StubPageProps {
  title: string;
  description: string;
  taskRef: string;
}

/** Shared placeholder body for Phase 0 stub routes. */
export function StubPage({ title, description, taskRef }: StubPageProps) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
      <div className="mt-8 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
        <p className="text-sm text-slate-500">
          This area ships in a later phase ({taskRef}). The route and shell exist so navigation,
          auth guards, and layout land on stable ground.
        </p>
      </div>
    </div>
  );
}
