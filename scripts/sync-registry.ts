import { access, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REGISTRY_SCHEMA = 'https://ui.shadcn.com/schema/registry.json'
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
  stability?: string
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
  const items = []

  for (const templateId of templateIds) {
    const templateDir = path.join(packageRoot, 'templates', templateId)
    const summary = await readTemplateSummary(packageRoot, templateDir, templateId)
    const relativeFilePaths = await listTemplateFiles(templateDir)
    const docs = await readOptionalReadme(templateDir)

    items.push(
      templateSummaryToRegistryItem({
        summary,
        fileRefs: createTemplateFileRefs(templateId, relativeFilePaths),
        docs,
      })
    )

    await removeLegacyTemplateRegistry(path.join(templateDir, 'registry.json'))
  }

  const rootRegistry = {
    $schema: REGISTRY_SCHEMA,
    name: REGISTRY_NAME,
    homepage: REGISTRY_HOMEPAGE,
    items,
  }

  await writeFile(
    path.join(packageRoot, 'registry.json'),
    `${JSON.stringify(rootRegistry, null, 2)}\n`
  )
}

async function listTemplateIds(packageRoot: string): Promise<string[]> {
  const templatesDir = path.join(packageRoot, 'templates')

  try {
    const entries = await readdir(templatesDir, { withFileTypes: true })
    const fromDisk = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))

    if (fromDisk.length > 0) {
      return fromDisk
    }
  } catch {
    // Fall through to registry.json discovery.
  }

  const registryPath = path.join(packageRoot, 'registry.json')
  const manifest = JSON.parse(await readFile(registryPath, 'utf8')) as {
    templates?: string[]
    include?: string[]
    items?: Array<{ name?: string }>
  }

  if (Array.isArray(manifest.templates) && manifest.templates.length > 0) {
    return manifest.templates
  }

  if (Array.isArray(manifest.items) && manifest.items.length > 0) {
    return manifest.items
      .map((item) => item.name)
      .filter((templateId): templateId is string => Boolean(templateId))
      .sort((a, b) => a.localeCompare(b))
  }

  if (Array.isArray(manifest.include) && manifest.include.length > 0) {
    return manifest.include
      .map((includePath) => {
        const match = includePath.match(/^templates\/([^/]+)\/registry\.json$/)
        return match?.[1]
      })
      .filter((templateId): templateId is string => Boolean(templateId))
  }

  throw new Error('No templates found in templates/ or registry.json')
}

async function readTemplateSummary(
  packageRoot: string,
  templateDir: string,
  templateId: string
): Promise<TemplateSummary> {
  const templateJsonPath = path.join(templateDir, 'template.json')

  if (await fileExists(templateJsonPath)) {
    const summary = parseTemplateSummary(JSON.parse(await readFile(templateJsonPath, 'utf8')))

    if (summary.id !== templateId) {
      throw new Error(`Template "${templateId}" metadata id must match its folder name`)
    }

    return summary
  }

  const legacyRegistryPath = path.join(templateDir, 'registry.json')

  if (await fileExists(legacyRegistryPath)) {
    return summaryFromRegistryItem(readRegistryItem(JSON.parse(await readFile(legacyRegistryPath, 'utf8'))))
  }

  const rootItem = await readRootRegistryItem(packageRoot, templateId)

  if (rootItem) {
    return summaryFromRegistryItem(rootItem)
  }

  throw new Error(
    `Template "${templateId}" is missing metadata. Add templates/${templateId}/template.json`
  )
}

async function readRootRegistryItem(
  packageRoot: string,
  templateId: string
): Promise<Record<string, unknown> | undefined> {
  const registryPath = path.join(packageRoot, 'registry.json')
  const manifest = JSON.parse(await readFile(registryPath, 'utf8'))

  if (!Array.isArray(manifest.items)) {
    return undefined
  }

  const item = manifest.items.find(
    (candidate: unknown) => isRecord(candidate) && candidate.name === templateId
  )

  return item && isRecord(item) ? item : undefined
}

function summaryFromRegistryItem(item: Record<string, unknown>): TemplateSummary {
  const meta = isRecord(item.meta) ? item.meta : {}

  return parseTemplateSummary({
    id: item.name,
    name: item.title ?? item.name,
    description: item.description ?? '',
    category: Array.isArray(item.categories) ? item.categories[0] : meta.category ?? 'Core',
    version: meta.version ?? '1.0.0',
    stability: readOptionalString(meta, 'stability'),
    tags: meta.tags,
    dependencies:
      meta.dependencies ??
      registryDependenciesToTemplateDependencies(
        Array.isArray(item.registryDependencies) ? item.registryDependencies : undefined
      ),
    defaultEnabled: meta.defaultEnabled,
    author: meta.author,
    repository: meta.repository,
    license: meta.license,
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

async function listTemplateFiles(templateDir: string): Promise<string[]> {
  return (await listFiles(templateDir)).filter(isTemplateSourceFile)
}

function isTemplateSourceFile(relativeFilePath: string): boolean {
  const basename = path.posix.basename(relativeFilePath)
  const segments = relativeFilePath.split('/')
  const topLevelFile = !relativeFilePath.includes('/')

  if (
    basename === '.DS_Store' ||
    basename === 'deno.lock' ||
    basename === '.setup-cache.bin' ||
    basename.endsWith('.lock.poll')
  ) {
    return false
  }

  if (
    segments.some((segment) =>
      [
        '.cache',
        '.deno',
        '.git',
        '.supabase',
        'build',
        'coverage',
        'dist',
        'node_modules',
      ].includes(segment)
    )
  ) {
    return false
  }

  if (topLevelFile && ['readme.md', 'template.json', 'registry.json'].includes(basename.toLowerCase())) {
    return false
  }

  return true
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function removeLegacyTemplateRegistry(registryPath: string) {
  if (!(await fileExists(registryPath))) {
    return
  }

  await unlink(registryPath)
}

function toRegistryDependencyRef(templateId: string): string {
  return `${REGISTRY_GITHUB_SLUG}/${templateId}`
}

function registryDependenciesToTemplateDependencies(
  registryDependencies?: string[]
): TemplateDependencies | undefined {
  if (!registryDependencies?.length) {
    return undefined
  }

  const required = registryDependencies.map(parseRegistryDependencyRef).filter(Boolean)

  return required.length > 0 ? { required } : undefined
}

function parseRegistryDependencyRef(ref: string): string {
  const normalized = ref.trim()
  const prefix = `${REGISTRY_GITHUB_SLUG}/`

  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length)
  }

  const slashIndex = normalized.indexOf('/')
  if (slashIndex === -1) {
    return normalized
  }

  return normalized.slice(slashIndex + 1)
}

function readRegistryItem(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Registry file must be an object')
  }

  if (Array.isArray(value.items) && value.items.length > 0) {
    const item = value.items[0]
    if (!isRecord(item)) {
      throw new Error('Registry item must be an object')
    }
    return item
  }

  if (typeof value.name === 'string' && typeof value.type === 'string') {
    return value
  }

  throw new Error('Registry file must define items or a registry item')
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
      stability: summary.stability,
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

function createTemplateFileRefs(
  templateId: string,
  relativeFilePaths: string[]
): RegistryFileRef[] {
  return relativeFilePaths.map((relativeFilePath) => {
    return {
      path: `templates/${templateId}/${relativeFilePath}`,
      type: 'registry:file',
      target: `~/${relativeFilePath}`,
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
    stability: readOptionalString(value, 'stability'),
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
