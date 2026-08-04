'use server'

import { decideApproval } from '@/server/assistant/approvals'

import { revalidatePath } from 'next/cache'
import {
  createChannel,
  joinChannel,
  markRead,
  openDirectMessage,
  sendMessage,
} from '@/server/chat/mutations'

export interface ChatActionState {
  error?: string
}

function messageFor(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAMemberError') return error.message
    // Validation messages are already written in the product's voice.
    if (error.message && error.message.length < 120) return error.message
  }
  return 'That did not send. Try again.'
}

export async function sendMessageAction(
  channelId: string,
  body: string,
): Promise<ChatActionState> {
  try {
    await sendMessage(channelId, body)
  } catch (error) {
    return { error: messageFor(error) }
  }
  revalidatePath('/chat')
  return {}
}

export async function markReadAction(channelId: string): Promise<void> {
  await markRead(channelId)
  revalidatePath('/chat')
  revalidatePath('/home')
}

export async function createChannelAction(name: string): Promise<{ error?: string; id?: string }> {
  try {
    const id = await createChannel(name)
    revalidatePath('/chat')
    return { id }
  } catch (error) {
    return { error: messageFor(error) }
  }
}

export async function openDirectMessageAction(
  userId: string,
): Promise<{ error?: string; id?: string }> {
  try {
    const id = await openDirectMessage(userId)
    revalidatePath('/chat')
    return { id }
  } catch (error) {
    return { error: messageFor(error) }
  }
}

export async function joinChannelAction(channelId: string): Promise<ChatActionState> {
  try {
    await joinChannel(channelId)
  } catch (error) {
    return { error: messageFor(error) }
  }
  revalidatePath('/chat')
  return {}
}

/**
 * The approver's answer to a change someone asked them to make (ADR 0008).
 *
 * Thin on purpose: every rule — is it yours to decide, is it still pending,
 * are you still allowed to make this change — lives in decideApproval,
 * where it runs against the database rather than against whatever the
 * browser believed when it rendered the button.
 */
export async function decideApprovalAction(
  requestId: string,
  decision: 'approved' | 'denied',
  note?: string,
): Promise<{ ok: boolean; message: string }> {
  const result = await decideApproval(requestId, decision, note)
  revalidatePath('/chat')
  revalidatePath('/calendar')
  revalidatePath('/today')
  revalidatePath('/home')
  return result
}
