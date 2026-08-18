import { ClientsView, type ClientDetail } from '@/components/clients/clients-view'
import { PageHeader } from '@/components/shell/page-header'
import { can } from '@/lib/permissions'
import { getActor, redirectStaleSession } from '@/server/auth/session'
import { listClientHistory, listClients } from '@/server/clients/queries'

export default async function ClientsPage() {
  const actor = await getActor()
  if (!actor) redirectStaleSession()

  const rows = await listClients(actor)

  // History for each client, in parallel. Bounded by the client count, which
  // for an agency of this size is single digits.
  const histories = await Promise.all(
    rows.map((c) => listClientHistory(actor, c.id)),
  )

  const clients: ClientDetail[] = rows.map((c, i) => ({
    ...c,
    history: (histories[i] ?? []).map((h) => ({
      id: h.id,
      title: h.title,
      startsAt: h.startsAt.toISOString(),
      status: h.status,
      conferencingProvider: h.conferencingProvider,
    })),
  }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Clients" />
      <div className="min-h-0 flex-1 overflow-auto">
        <ClientsView
          clients={clients}
          canManage={can(actor, 'client.manage')}
          zone={actor.timezone}
        />
      </div>
    </div>
  )
}
