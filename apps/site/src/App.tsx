import { AuthPage } from '@/pages/AuthPage'
import { ClientsPage } from '@/pages/ClientsPage'
import { ConsentPage } from '@/pages/ConsentPage'
import { HomePage } from '@/pages/HomePage'
import { SetupPage } from '@/pages/SetupPage'
import { TasksPage } from '@/pages/TasksPage'

export function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'

  if (pathname === '/auth') return <AuthPage />
  if (pathname === '/setup') return <SetupPage />
  if (pathname === '/tasks') return <TasksPage />
  if (pathname === '/clients') return <ClientsPage />
  if (pathname === '/oauth/consent') return <ConsentPage />

  return <HomePage />
}

