'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { HealthDot } from '@/components/ui/health-dot';
import { ContentTypeBadge, Badge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { ConnectWizard } from '@/components/connect-wizard';
import { compactNumber } from '@/lib/format';
import { getAccounts } from '@/lib/mock-data';

export default function AccountsPage() {
  const accounts = getAccounts();
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="All connected channels and pages across platforms"
        actions={
          <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
            Connect account
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => (
          <Link key={a.id} href={`/accounts/${a.id}` as Route}>
            <Card className="p-4 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="relative">
                    <Avatar name={a.name} size="lg" />
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-white p-1 shadow-sm">
                      <PlatformIcon platform={a.platform} size={13} />
                    </span>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">{a.name}</p>
                    <p className="text-xs text-zinc-500">{a.handle}</p>
                  </div>
                </div>
                <HealthDot status={a.health} />
              </div>
              <div className="mt-3 flex items-center gap-1.5">
                <ContentTypeBadge type={a.contentType} />
                {a.monetized && <Badge tone="green">Monetized</Badge>}
                {a.paused && <Badge tone="amber">Paused</Badge>}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3 text-center">
                <div>
                  <p className="nums text-sm font-semibold text-zinc-900">{compactNumber(a.followers)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400">Followers</p>
                </div>
                <div>
                  <p className="nums text-sm font-semibold text-zinc-900">{compactNumber(a.views30d)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400">Views 30d</p>
                </div>
                <div>
                  <p className="nums text-sm font-semibold text-zinc-900">{a.scheduledCount}</p>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400">Scheduled</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <ConnectWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
