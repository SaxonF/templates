import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY_SCHEMA = 'https://ui.shadcn.com/schema/registry.json'
const REGISTRY_ITEM_SCHEMA = 'https://ui.shadcn.com/schema/registry-item.json'
const REGISTRY_NAME = 'supabase-templates'
const REGISTRY_HOMEPAGE = 'https://github.com/SaxonF/templates'
const REGISTRY_GITHUB_SLUG = 'SaxonF/templates'

interface TemplateAuthor {
  name: string
  url?: string
}

interface TemplateDependencies {
  required?: string[]
  optional?: string[]
}

interface TemplateSummary {
  id: string
  name: string
  description: string
  category: string
  version: string
  tags?: string[]
  dependencies?: TemplateDependencies
  defaultEnabled?: boolean
  author?: TemplateAuthor
  repository?: string
  license?: string
}

interface RegistryFileRef {
  path: string
  type: string
  target?: string
}

const defaultPackageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function syncRegistry(packageRoot = defaultPackageRoot) {
  const templateIds = await listTemplateIds(packageRoot)
  const includePaths: string[] = []

  for (const templateId of templateIds) {
    const templateDir = path.join(packageRoot, 'templates', templateId)
    const summary = await readTemplateSummary(templateDir, templateId)
    const relativeFilePaths = await listFiles(path.join(templateDir, 'supabase'))
    const docs = await readOptionalReadme(templateDir)
    const item = templateSummaryToRegistryItem({
      summary,
      fileRefs: createTemplateFileRefs(relativeFilePaths),
      docs,
    })

    const itemPath = path.join(templateDir, 'registry.json')
    await writeFile(itemPath, `${JSON.stringify(item, null, 2)}\n`)
    includePaths.push(path.posix.join('templates', templateId, 'registry.json'))
  }

  const rootRegistry = {
    $schema: REGISTRY_SCHEMA,
    name: REGISTRY_NAME,
    homepage: REGISTRY_HOMEPAGE,
    include: includePaths,
  }

  await writeFile(
    path.join(packageRoot, 'registry.json'),
    `${JSON.stringify(rootRegistry, null, 2)}\n`
  )
}

async function listTemplateIds(packageRoot: string): Promise<string[]> {
  const registryPath = path.join(packageRoot, 'registry.json')
  const manifest = JSON.parse(await readFile(registryPath, 'utf8')) as {
    templates?: string[]
    include?: string[]
  }

  if (Array.isArray(manifest.templates) && manifest.templates.length > 0) {
    return manifest.templates
  }

  if (Array.isArray(manifest.include) && manifest.include.length > 0) {
    return manifest.include
      .map((includePath) => {
        const match = includePath.match(/^templates\/([^/]+)\/registry\.json$/)
        return match?.[1]
      })
      .filter((templateId): templateId is string => Boolean(templateId))
  }

  const entries = await readdir(path.join(packageRoot, 'templates'), { withFileTypes: true })

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

async function readTemplateSummary(templateDir: string, templateId: string) {
  const templateJsonPath = path.join(templateDir, 'template.json')

  if (await fileExists(templateJsonPath)) {
    const summary = parseTemplateSummary(JSON.parse(await readFile(templateJsonPath, 'utf8')))

    if (summary.id !== templateId) {
      throw new Error(`Template "${templateId}" metadata id must match its folder name`)
    }

    return summary
  }

  const registryPath = path.join(templateDir, 'registry.json')
  const item = JSON.parse(await readFile(registryPath, 'utf8'))

  return parseTemplateSummary({
    id: item.name,
    name: item.title ?? item.name,
    description: item.description ?? '',
    category: item.categories?.[0] ?? item.meta?.category ?? 'Core',
    version: item.meta?.version ?? '1.0.0',
    tags: item.meta?.tags,
    dependencies: item.meta?.dependencies,
    defaultEnabled: item.meta?.defaultEnabled,
    author: item.meta?.author,
    repository: item.meta?.repository,
    license: item.meta?.license,
  })
}

async function readOptionalReadme(templateDir: string): Promise<string | undefined> {
  const readmePath = path.join(templateDir, 'readme.md')

  if (!(await fileExists(readmePath))) {
    return undefined
  }

  const content = (await readFile(readmePath, 'utf8')).trim()
  return content.length > 0 ? content : undefined
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        return (await listFiles(entryPath)).map((filePath) => path.posix.join(entry.name, filePath))
      }

      if (entry.isFile()) {
        return [entry.name]
      }

      return []
    })
  )

  return files.flat().sort((a, b) => a.localeCompare(b))
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function toRegistryDependencyRef(templateId: string): string {
  return `${REGISTRY_GITHUB_SLUG}/${templateId}`
}

function templateSummaryToRegistryItem({
  summary,
  fileRefs,
  docs,
}: {
  summary: TemplateSummary
  fileRefs: RegistryFileRef[]
  docs?: string
}) {
  const requiredDeps = summary.dependencies?.required ?? []

  return {
    $schema: REGISTRY_ITEM_SCHEMA,
    name: summary.id,
    type: 'registry:item',
    title: summary.name,
    description: summary.description,
    categories: [summary.category],
    registryDependencies: requiredDeps.map(toRegistryDependencyRef),
    files: fileRefs,
    ...(docs ? { docs } : {}),
    meta: {
      version: summary.version,
      defaultEnabled: summary.defaultEnabled,
      tags: summary.tags,
      category: summary.category,
      license: summary.license,
      repository: summary.repository,
      author: summary.author,
      dependencies: summary.dependencies,
    },
  }
}

function createTemplateFileRefs(relativeFilePaths: string[]): RegistryFileRef[] {
  return relativeFilePaths.map((relativeFilePath) => {
    const targetPath = `supabase/${relativeFilePath}`

    return {
      path: targetPath,
      type: 'registry:file',
      target: `~/${targetPath}`,
    }
  })
}

function parseTemplateSummary(value: unknown): TemplateSummary {
  if (!isRecord(value)) {
    throw new Error('Template metadata must be an object')
  }

  return {
    id: readString(value, 'id'),
    name: readString(value, 'name'),
    description: readString(value, 'description'),
    category: readString(value, 'category'),
    version: readString(value, 'version'),
    tags: readOptionalStringArray(value, 'tags'),
    dependencies: parseDependencies(value.dependencies),
    defaultEnabled: typeof value.defaultEnabled === 'boolean' ? value.defaultEnabled : undefined,
    author: parseAuthor(value.author),
    repository: readOptionalString(value, 'repository'),
    license: readOptionalString(value, 'license'),
  }
}

function parseDependencies(value: unknown): TemplateDependencies | undefined {
  if (value === undefined) return undefined

  if (!isRecord(value)) {
    throw new Error('Template dependencies must be an object')
  }

  return {
    required: readOptionalStringArray(value, 'required'),
    optional: readOptionalStringArray(value, 'optional'),
  }
}

function parseAuthor(value: unknown): TemplateAuthor | undefined {
  if (value === undefined) return undefined

  if (!isRecord(value)) {
    throw new Error('Template author must be an object')
  }

  return {
    name: readString(value, 'name'),
    url: readOptionalString(value, 'url'),
  }
}

function readString(value: Record<string, unknown>, key: string): string {
  const field = value[key]

  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new Error(`Template field "${key}" must be a non-empty string`)
  }

  return field
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]

  if (field === undefined) return undefined

  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new Error(`Template field "${key}" must be a non-empty string when provided`)
  }

  return field
}

function readOptionalStringArray(
  value: Record<string, unknown>,
  key: string
): string[] | undefined {
  const field = value[key]

  if (field === undefined) return undefined

  if (!Array.isArray(field) || field.some((item) => typeof item !== 'string')) {
    throw new Error(`Template field "${key}" must be an array of strings`)
  }

  return field
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const isDirectExecution = process.argv[1]?.endsWith('sync-registry.ts')

if (isDirectExecution) {
  syncRegistry().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
