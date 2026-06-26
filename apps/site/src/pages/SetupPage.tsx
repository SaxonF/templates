import { useMemo, useState } from 'react'

import { AuthGate } from '@/components/layout/AuthGate'
import { PageIntro, PageLayout } from '@/components/layout/PageLayout'
import { PageShell } from '@/components/layout/PageShell'
import { CliBlock } from '@/components/ui/cli-block'
import { CmdRow } from '@/components/ui/cmd-row'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { MCP_SERVER_DESCRIPTION, MCP_SERVER_NAME, MCP_SERVER_URL } from '@/lib/config'
import { cn } from '@/lib/utils'

type Harness = 'codex' | 'chatgpt' | 'claude' | 'cursor'

function shellArg(value: string) {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

const labels: Record<Harness, string> = {
  codex: 'Codex',
  chatgpt: 'ChatGPT',
  claude: 'Claude Code',
  cursor: 'Cursor',
}

export function SetupPage() {
  return (
    <AuthGate activePage="setup">
      {(user) => (
        <PageShell user={user} variant="account" activePage="setup">
          <SetupContent />
        </PageShell>
      )}
    </AuthGate>
  )
}

function SetupContent() {
  const [selected, setSelected] = useState<Harness>('codex')
  const [status, setStatus] = useState<string | null>(null)
  const mcpServerName = MCP_SERVER_NAME.trim() || 'tasks'

  const harnesses = useMemo(
    () => ({
      codex: {
        cli:
          `codex mcp add ${shellArg(mcpServerName)} --url ${shellArg(MCP_SERVER_URL)} && ` +
          `codex mcp login ${shellArg(mcpServerName)}`,
        cliShell: true,
        steps: [
          'Run the command.',
          'Complete sign-in in the browser.',
          'Start a new session and run /mcp.',
        ],
      },
      chatgpt: {
        fields: [
          { label: 'Name', value: mcpServerName },
          { label: 'Description', value: MCP_SERVER_DESCRIPTION },
          { label: 'URL', value: MCP_SERVER_URL, mono: true },
        ],
        steps: [
          'In ChatGPT, go to Settings → Connectors.',
          'Use the configured connector name and description, then paste the HTTPS MCP server URL.',
          'Create the connector, start a new chat, choose it from the composer tool menu, and complete sign-in.',
        ],
      },
      claude: {
        commands: [
          `claude mcp add --transport http --scope user ${shellArg(mcpServerName)} ${shellArg(MCP_SERVER_URL)}`,
        ],
        steps: [
          'Run the command.',
          'Run /mcp in Claude Code.',
          'Select the server and complete sign-in.',
        ],
      },
      cursor: {
        cli: JSON.stringify({ mcpServers: { [mcpServerName]: { url: MCP_SERVER_URL } } }, null, 2),
        steps: [
          'Add the configuration to ~/.cursor/mcp.json or .cursor/mcp.json.',
          'Save the file.',
          'Enable the configured server in MCP settings.',
          'Complete sign-in in the browser.',
        ],
      },
    }),
    [mcpServerName]
  )

  const current = harnesses[selected]

  return (
    <PageLayout
      intro={
        <PageIntro
          title="Connect MCP"
          lead="The template includes a page where authenticated users get the MCP server URL and client-specific setup commands — the starting point for connecting an agent to the database."
        />
      }
      panel={
        <div>
          <div>
            <strong className="font-medium">Server URL</strong>
            <div className="mt-2 grid gap-2">
              <CmdRow value={MCP_SERVER_URL} onCopyError={setStatus} />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-0.5" role="tablist" aria-label="MCP client">
            {(Object.keys(labels) as Harness[]).map((key) => (
              <Button
                key={key}
                type="button"
                role="tab"
                variant="tab"
                data-active={selected === key}
                aria-selected={selected === key}
                onClick={() => setSelected(key)}
              >
                {labels[key]}
              </Button>
            ))}
          </div>

          <article className="mt-4" role="tabpanel">
            {'fields' in current && current.fields ? (
              <div className="mt-2 overflow-hidden rounded-[13px] border border-border bg-white/[0.04] text-sm">
                {current.fields.map((field, index) => (
                  <div
                    key={field.label}
                    className={cn(
                      'flex flex-col gap-1.5 px-4 py-2.5',
                      index < current.fields.length - 1 && 'border-b border-border'
                    )}
                  >
                    <span className="text-muted-foreground">{field.label}</span>
                    <div className="flex items-start justify-between gap-2">
                      {field.mono ? (
                        <code className="min-w-0 break-all font-mono">{field.value}</code>
                      ) : (
                        <span className="min-w-0">{field.value}</span>
                      )}
                      <CopyButton value={field.value} onError={setStatus} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {'cli' in current && current.cli ? (
              <CliBlock
                value={current.cli}
                shell={'cliShell' in current && current.cliShell}
                onCopyError={setStatus}
              />
            ) : null}

            {'commands' in current && current.commands ? (
              <div className="mt-2 grid gap-2">
                {current.commands.map((command) => (
                  <CmdRow key={command} value={command} shell onCopyError={setStatus} />
                ))}
              </div>
            ) : null}

            <ol className="mt-3 list-decimal space-y-1 pl-[1.1rem] text-muted-foreground">
              {current.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>

          {status ? (
            <p className={cn('mt-4', status.includes('Unable') ? 'text-destructive' : 'text-muted-foreground')} role="status">
              {status}
            </p>
          ) : null}
        </div>
      }
    />
  )
}
