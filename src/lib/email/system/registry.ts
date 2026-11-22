import { EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY } from './constants'
import { batch1Templates } from './templates/batch-1'
import { batch2Templates } from './templates/batch-2'
import { batch3Templates } from './templates/batch-3'
import { batch4Templates } from './templates/batch-4'
import { exampleSystemEmailTemplate } from './templates/example'
import type { SystemEmailContent, SystemEmailTemplate } from './types'

export function assertUniqueTemplateKeys(templates: readonly SystemEmailTemplate[]): void {
  const seen = new Set<string>()
  for (const template of templates) {
    const key = template.key.trim()
    if (!key || seen.has(key)) {
      throw new Error(`Duplicate system email template key: ${template.key}`)
    }
    seen.add(key)
  }
}

/** The test example is never part of a production send. */
export function isExampleSystemTemplateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLAYWRIGHT_TEST === 'true'
}

/**
 * Batch templates come only from their own files. This module does not
 * declare template bodies, so later packages do not edit it to add a key.
 */
export function listSystemEmailTemplates(env: NodeJS.ProcessEnv = process.env): SystemEmailTemplate[] {
  const templates: SystemEmailTemplate[] = [
    ...batch1Templates,
    ...batch2Templates,
    ...batch3Templates,
    ...batch4Templates,
  ]
  if (isExampleSystemTemplateEnabled(env)) {
    templates.push(exampleSystemEmailTemplate)
  }
  assertUniqueTemplateKeys(templates)
  return templates
}

export function getSystemEmailTemplate(
  templateKey: string,
  env: NodeJS.ProcessEnv = process.env,
): SystemEmailTemplate | null {
  const key = templateKey.trim()
  return listSystemEmailTemplates(env).find((template) => template.key === key) ?? null
}

export function renderSystemEmail(
  template: SystemEmailTemplate,
  data: Record<string, string>,
): SystemEmailContent {
  return template.render({ ...template.sampleData, ...data })
}

export function previewSystemEmail(
  templateKey: string,
  data: Record<string, string> = {},
  env: NodeJS.ProcessEnv = process.env,
): SystemEmailContent | null {
  const template = getSystemEmailTemplate(templateKey, env)
  if (!template) return null
  return renderSystemEmail(template, data)
}

export { EXAMPLE_SYSTEM_EMAIL_TEMPLATE_KEY }
