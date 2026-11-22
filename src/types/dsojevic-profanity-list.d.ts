declare module '@dsojevic/profanity-list' {
  type ProfanityEntry = {
    id: string
    match: string
    severity: number
    tags?: string[]
    exceptions?: string[]
  }

  const list: {
    en: ProfanityEntry[]
    emoji: ProfanityEntry[]
  }

  export default list
}
