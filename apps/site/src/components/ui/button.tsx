import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border-0 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'bg-[#fff] text-[#000] hover:bg-[#fff]/90',
        destructive:
          'border border-border bg-transparent text-destructive hover:bg-transparent hover:text-destructive',
        outline:
          'border border-border bg-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
        secondary:
          'border border-border bg-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
        ghost: 'bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
        link: 'h-auto rounded-none bg-transparent p-0 text-foreground underline-offset-4 hover:underline',
        tab: 'rounded-full border-0 bg-transparent px-4 py-2 text-[0.87rem] font-medium text-muted-foreground hover:bg-transparent hover:text-foreground data-[active=true]:bg-white/[0.08] data-[active=true]:text-foreground',
      },
      size: {
        default: 'min-h-[2.25rem] px-[0.9rem] py-[0.45rem]',
        sm: 'min-h-9 px-3 py-2 text-[13px]',
        lg: 'min-h-11 px-5 py-2.5',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
