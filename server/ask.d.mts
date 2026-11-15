import type { Plugin } from 'vite'

export function askPlugin(keys: { gemini?: string; cala?: string }): Plugin
