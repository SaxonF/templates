import type { TargetAndTransition, Transition } from 'motion/react'

export type MessageAnimationId = 'fade' | 'pop' | 'slide'

type MessageRoleAnimation = {
  initial: TargetAndTransition
  animate: TargetAndTransition
  transition: Transition
}

export type MessageAnimationPreset = {
  id: MessageAnimationId
  name: string
  user: MessageRoleAnimation
  assistant: MessageRoleAnimation
}

export const MESSAGE_ANIMATIONS = {
  fade: {
    id: 'fade',
    name: 'Fade',
    user: {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.22, ease: [0.23, 1, 0.32, 1] },
    },
    assistant: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.2, ease: 'easeOut' },
    },
  },
  pop: {
    id: 'pop',
    name: 'Pop',
    user: {
      initial: { opacity: 0, y: 10, scale: 0.97 },
      animate: { opacity: 1, y: 0, scale: 1 },
      transition: { type: 'spring', stiffness: 500, damping: 32, mass: 0.8 },
    },
    assistant: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.25, ease: 'easeOut' },
    },
  },
  slide: {
    id: 'slide',
    name: 'Slide',
    user: {
      initial: { opacity: 0, y: 16 },
      animate: { opacity: 1, y: 0 },
      transition: { type: 'spring', stiffness: 420, damping: 30 },
    },
    assistant: {
      initial: { opacity: 0, y: 6 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.2, ease: 'easeOut' },
    },
  },
} satisfies Record<MessageAnimationId, MessageAnimationPreset>

export const defaultMessageAnimation = MESSAGE_ANIMATIONS.pop
