import { redirect } from 'next/navigation'
import { ChatView, type MessageDto } from '@/components/chat/chat-view'
import { PageHeader } from '@/components/shell/page-header'
import { getActor } from '@/server/auth/session'
import {
  isOnline,
  listChattablePeople,
  listConversations,
  listJoinableChannels,
  listMessages,
} from '@/server/chat/queries'

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  const actor = await getActor()
  if (!actor) redirect('/login')

  const { c } = await searchParams

  const [conversations, joinable, people] = await Promise.all([
    listConversations(actor),
    listJoinableChannels(actor),
    listChattablePeople(actor),
  ])

  // An unknown or non-member id falls back to the first conversation rather
  // than erroring — a stale bookmark should not be a dead end.
  const activeId = conversations.some((conv) => conv.id === c)
    ? (c ?? null)
    : (conversations[0]?.id ?? null)

  // listMessages returns nothing for a channel the actor is not in, so
  // membership is enforced at the query, not by this page.
  const messages: MessageDto[] = activeId
    ? (await listMessages(actor, activeId)).map((m) => ({
        id: m.id,
        authorUserId: m.authorUserId,
        authorName: m.authorName,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        mine: m.mine,
        ...(m.approval ? { approval: m.approval } : {}),
      }))
    : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Chat" />
      <div className="min-h-0 flex-1">
        <ChatView
          conversations={conversations.map((conv) => ({
            id: conv.id,
            kind: conv.kind,
            label: conv.label,
            unread: conv.unread,
            online: conv.online,
          }))}
          joinable={joinable}
          people={people.map((p) => ({
            id: p.id,
            fullName: p.fullName,
            online: isOnline(p.lastSeenAt),
          }))}
          activeId={activeId}
          messages={messages}
          zone={actor.timezone}
        />
      </div>
    </div>
  )
}
