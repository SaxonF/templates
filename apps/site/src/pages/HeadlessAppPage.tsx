import { useState } from 'react'

import { HeroDemo } from '@/components/home/HeroDemo'
import { PageShell } from '@/components/layout/PageShell'

const installCommand = 'npx shadcn@latest add SaxonF/templates/headless-app'

const features = ['MCP Server', "Auth'd DB access", 'Auth & consent'] as const

export function HeadlessAppPage() {
  const [copied, setCopied] = useState(false)

  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(installCommand)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // ignore
    }
  }

  return (
    <PageShell variant="landing" landingPage="headless-app">
      <section className="grid w-full items-center gap-10 lg:grid-cols-[1fr_1.06fr] lg:gap-[60px]">
        <div className="max-w-[540px]">
          <h1 className="text-2xl font-medium leading-[1.15] text-white">
            Deploy a headless app.
          </h1>

          <p className="mt-7 max-w-[482px] text-[15px] leading-[1.45] text-[#9aa0a8]">
            Give your agent direct, access‑controlled reach into your database and back‑end. Ships
            with auth and consent screens so any MCP client connects safely — then extend it however
            you want.
          </p>

          <div className="mt-9 flex max-w-[430px] items-center justify-between gap-2.5 rounded-[13px] border border-border bg-white/[0.04] py-2 pr-2.5 pl-3">
            <code className="min-w-0 flex-1 truncate font-mono text-[14.5px] text-[#e5e7eb]">
              <span className="text-primary">$</span> {installCommand}
            </code>
            <button
              type="button"
              onClick={copyInstallCommand}
              className="flex-none rounded-lg border border-border bg-white/[0.06] px-2.5 py-1.5 text-[13px] text-[#c5c9d0] transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>

          <a
            href="/auth/"
            className="mt-4 inline-flex items-center gap-1.5 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
          >
            or try the demo
          </a>

          <div className="mt-10 flex flex-wrap gap-x-[22px] gap-y-2.5">
            {features.map((item) => (
              <span key={item} className="text-sm text-[#6b7079]">
                <span className="text-primary">✓</span> {item}
              </span>
            ))}
          </div>
        </div>

        <HeroDemo />
      </section>
    </PageShell>
  )
}
