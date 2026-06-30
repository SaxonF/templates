import { useState } from 'react'

import { MarkdownContent } from '@/components/templates/MarkdownContent'
import { PageShell } from '@/components/layout/PageShell'
import { getTemplate, templateInstallCommand } from '@/lib/templates'

interface TemplateDetailPageProps {
  slug: string
}

export function TemplateDetailPage({ slug }: TemplateDetailPageProps) {
  const template = getTemplate(slug)

  if (!template) {
    return (
      <PageShell variant="landing" landingPage="templates" landingAlign="top">
        <div className="mx-auto w-full max-w-[720px]">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
          >
            ← All templates
          </a>
          <h1 className="mt-6 text-2xl font-medium text-white">Template not found</h1>
          <p className="mt-3 text-[15px] text-[#9aa0a8]">
            No template matches <code className="text-[#e5e7eb]">{slug}</code>.
          </p>
        </div>
      </PageShell>
    )
  }

  const installCommand = templateInstallCommand(template.id)

  return (
    <PageShell variant="landing" landingPage="templates" landingAlign="top">
      <TemplateDetailContent
        template={template}
        installCommand={installCommand}
      />
    </PageShell>
  )
}

function TemplateDetailContent({
  template,
  installCommand,
}: {
  template: NonNullable<ReturnType<typeof getTemplate>>
  installCommand: string
}) {
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
    <div className="mx-auto w-full max-w-[720px]">
      <a
        href="/"
        className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
      >
        ← All templates
      </a>

      <h1 className="mt-6 text-2xl font-medium text-white">{template.title}</h1>

      <p className="mt-3 text-[15px] leading-[1.45] text-[#9aa0a8]">
        {template.description}
      </p>

      <div className="mt-8 max-w-[560px]">
        <div className="flex items-center justify-between gap-2.5 rounded-[13px] border border-border bg-white/[0.04] py-2 pr-2.5 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-[14px] text-[#e5e7eb]">
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
          href={template.repositoryUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
        >
          or view on GitHub <span className="text-[13px]">↗</span>
        </a>
      </div>

      {template.docs ? (
        <div className="mt-10 border-t border-border pt-10">
          <MarkdownContent content={template.docs} />
        </div>
      ) : (
        <p className="mt-10 border-t border-border pt-10 text-[15px] text-[#9aa0a8]">
          Documentation for this template is not available yet.
        </p>
      )}
    </div>
  )
}
