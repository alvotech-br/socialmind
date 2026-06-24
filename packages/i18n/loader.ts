// Loader estático de mensagens — webpack resolve cada import em tempo de build
import ptBRCommon from './locales/pt-BR/common.json'
import ptBRAuth from './locales/pt-BR/auth.json'
import ptBRErrors from './locales/pt-BR/errors.json'
import ptBRPrivacy from './locales/pt-BR/privacy.json'
import ptBRWorkspace from './locales/pt-BR/workspace.json'

import enCommon from './locales/en/common.json'
import enAuth from './locales/en/auth.json'
import enErrors from './locales/en/errors.json'
import enPrivacy from './locales/en/privacy.json'
import enWorkspace from './locales/en/workspace.json'

import esCommon from './locales/es/common.json'
import esAuth from './locales/es/auth.json'
import esErrors from './locales/es/errors.json'
import esPrivacy from './locales/es/privacy.json'
import esWorkspace from './locales/es/workspace.json'

export const allMessages = {
  'pt-BR': {
    common: ptBRCommon,
    auth: ptBRAuth,
    errors: ptBRErrors,
    privacy: ptBRPrivacy,
    workspace: ptBRWorkspace,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    errors: enErrors,
    privacy: enPrivacy,
    workspace: enWorkspace,
  },
  es: {
    common: esCommon,
    auth: esAuth,
    errors: esErrors,
    privacy: esPrivacy,
    workspace: esWorkspace,
  },
} as const
