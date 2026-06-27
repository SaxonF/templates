import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent } from '@/components/ui/message'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import {
  defaultMessageAnimation,
  type MessageAnimationPreset,
} from '@/lib/message-animations'
import { cn } from '@/lib/utils'

const MotionMessageScrollerItem = motion.create(MessageScrollerItem)

type BubbleVariant = 'default' | 'secondary' | 'muted' | 'tinted' | 'outline' | 'ghost' | 'destructive'

export type AnimatedMessage = {
  id: string
  role: 'user' | 'assistant'
  text?: string
  content?: string
}

function getMessageText(message: AnimatedMessage) {
  return message.text ?? message.content ?? ''
}

export function MessageAnimated({
  message,
  scrollAnchor = false,
  userVariant = 'default',
  assistantVariant = 'ghost',
  animationPreset = defaultMessageAnimation,
  children,
  className,
}: {
  message: AnimatedMessage
  scrollAnchor?: boolean
  userVariant?: BubbleVariant
  assistantVariant?: BubbleVariant
  animationPreset?: MessageAnimationPreset
  children?: ReactNode
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const isUser = message.role === 'user'
  const preset = isUser ? animationPreset.user : animationPreset.assistant

  const body =
    children ??
    (getMessageText(message) ? (
      <Message align={isUser ? 'end' : 'start'}>
        <MessageContent>
          <Bubble align={isUser ? 'end' : 'start'} variant={isUser ? userVariant : assistantVariant}>
            <BubbleContent
              className={cn(
                isUser ? 'rounded-br-md' : 'whitespace-pre-wrap text-[#b4b9c1]'
              )}
            >
              {getMessageText(message)}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    ) : null)

  if (!body) return null

  return (
    <MotionMessageScrollerItem
      key={message.id}
      messageId={message.id}
      scrollAnchor={scrollAnchor}
      className={className}
      initial={reduceMotion ? false : preset.initial}
      animate={reduceMotion ? false : preset.animate}
      transition={reduceMotion ? undefined : preset.transition}
    >
      {body}
    </MotionMessageScrollerItem>
  )
}

export { MotionMessageScrollerItem }
