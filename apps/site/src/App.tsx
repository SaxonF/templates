import { AgentPage } from '@/pages/AgentPage'
import { AuthPage } from '@/pages/AuthPage'
import { ClientsPage } from '@/pages/ClientsPage'
import { ConsentPage } from '@/pages/ConsentPage'
import { HeadlessAppPage } from '@/pages/HeadlessAppPage'
import { SetupPage } from '@/pages/SetupPage'
import { TasksPage } from '@/pages/TasksPage'
import { TemplateDetailPage } from '@/pages/TemplateDetailPage'
import { TemplatesPage } from '@/pages/TemplatesPage'

export function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'

  if (pathname === '/auth') return <AuthPage />
  if (pathname === '/agent') return <AgentPage />
  if (pathname === '/setup') return <SetupPage />
  if (pathname === '/tasks') return <TasksPage />
  if (pathname === '/clients') return <ClientsPage />
  if (pathname === '/oauth/consent') return <ConsentPage />
  if (pathname === '/headless-app') return <HeadlessAppPage />
  if (pathname.startsWith('/templates/')) {
    const slug = pathname.slice('/templates/'.length)
    if (slug) return <TemplateDetailPage slug={slug} />
  }
  if (pathname === '/' || pathname === '/templates') return <TemplatesPage />

  return <TemplatesPage />
}

