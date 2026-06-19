import path from 'path'

export const defaultLocale = 'pt-BR' as const
export const locales = ['pt-BR', 'es', 'en'] as const
export type Locale = typeof locales[number]

export const localesDir = path.join(__dirname, 'locales')

export const namespaces = ['common', 'auth', 'errors', 'emails', 'privacy', 'workspace'] as const
export type Namespace = typeof namespaces[number]
