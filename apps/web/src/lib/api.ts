const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type FetchOptions = RequestInit & {
  token?: string
  workspaceId?: string
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, workspaceId, ...init } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  }

  if (token) headers['Authorization'] = `Bearer ${token}`
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId

  const res = await fetch(`${API_URL}${path}`, { ...init, headers })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.message ?? `HTTP ${res.status}`) as Error & { status: number }
    err.status = res.status
    throw err
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
