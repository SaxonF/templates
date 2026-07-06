import registry from '../../registry.json'

export interface TemplateSummary {
  id: string
  title: string
  description: string
  category: string
  tags: string[]
  docs?: string
  repositoryUrl: string
}

interface RegistryItem {
  name: string
  title: string
  description: string
  categories?: string[]
  docs?: string
  meta?: {
    tags?: string[]
    category?: string
    repository?: string
  }
}

interface Registry {
  items: RegistryItem[]
}

const TEMPLATE_REPOSITORY_BASE = 'https://github.com/SaxonF/templates/tree/main/templates'

function toSummary(item: RegistryItem): TemplateSummary {
  return {
    id: item.name,
    title: item.title,
    description: item.description,
    category: item.meta?.category ?? item.categories?.[0] ?? 'Other',
    tags: item.meta?.tags ?? [],
    docs: item.docs,
    repositoryUrl: item.meta?.repository ?? `${TEMPLATE_REPOSITORY_BASE}/${item.name}`,
  }
}

const summaries = (registry as Registry).items.map(toSummary)

export function listTemplates(): TemplateSummary[] {
  return [...summaries].sort((a, b) => a.title.localeCompare(b.title))
}

export function getTemplate(id: string): TemplateSummary | undefined {
  return summaries.find((template) => template.id === id)
}

export function groupTemplatesByCategory(
  templates: TemplateSummary[]
): { category: string; templates: TemplateSummary[] }[] {
  const grouped = new Map<string, TemplateSummary[]>()

  for (const template of templates) {
    const existing = grouped.get(template.category) ?? []
    existing.push(template)
    grouped.set(template.category, existing)
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, templates]) => ({ category, templates }))
}

export function filterTemplates(query: string): TemplateSummary[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return listTemplates()

  return listTemplates().filter((template) => {
    const haystack = [
      template.id,
      template.title,
      template.description,
      template.category,
      ...template.tags,
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalized)
  })
}

export function listTemplatesByCategory(): { category: string; templates: TemplateSummary[] }[] {
  return groupTemplatesByCategory(listTemplates())
}

export function templateInstallCommand(id: string) {
  return `npx shadcn@latest add SaxonF/templates/${id}`
}
