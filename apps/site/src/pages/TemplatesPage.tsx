import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PageShell } from '@/components/layout/PageShell'
import { Input } from '@/components/ui/input'
import { filterTemplates, groupTemplatesByCategory } from '@/lib/templates'

export function TemplatesPage() {
  const [query, setQuery] = useState('')
  const groups = useMemo(
    () => groupTemplatesByCategory(filterTemplates(query)),
    [query]
  )
  const hasResults = groups.some((group) => group.templates.length > 0)

  return (
    <PageShell variant="landing" landingPage="templates" landingAlign="top">
      <div className="mx-auto w-full max-w-[720px]">
        <h1 className="text-2xl font-medium text-white">Templates</h1>
        <p className="mt-3 text-[15px] leading-[1.45] text-[#9aa0a8]">
          Supabase building blocks you can add to a project with the shadcn CLI. Each template ships
          config, schemas, Edge Functions, and docs for a focused capability.
        </p>

        <div className="relative mt-6 w-full">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#6b7079]"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search templates"
            aria-label="Search templates"
            className="h-11 rounded-[13px] bg-white/[0.03] pr-3 pl-10 text-[15px]"
          />
        </div>

        <div className="mt-10 space-y-12">
          {hasResults ? (
            groups.map((group) =>
              group.templates.length > 0 ? (
                <section key={group.category}>
                  <h2 className="mb-4 text-sm font-medium tracking-[0.02em] text-[#6b7079] uppercase">
                    {group.category}
                  </h2>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {group.templates.map((template) => (
                      <li key={template.id}>
                        <a
                          href={`/templates/${template.id}/`}
                          className="group block rounded-[16px] border border-border bg-white/[0.03] p-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.05]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="text-[15px] font-medium text-white transition-colors group-hover:text-primary">
                                {template.title}
                              </h3>
                              <p className="mt-1.5 line-clamp-2 text-[14px] leading-[1.45] text-[#8a8f98]">
                                {template.description}
                              </p>
                            </div>
                            <span
                              aria-hidden="true"
                              className="flex-none text-[13px] text-[#6b7079] transition-colors group-hover:text-primary"
                            >
                              →
                            </span>
                          </div>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null
            )
          ) : (
            <p className="text-[15px] text-[#9aa0a8]">No templates match your search.</p>
          )}
        </div>
      </div>
    </PageShell>
  )
}
