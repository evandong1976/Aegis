// Placeholder for scripts whose milestone hasn't landed. Fails loudly instead of pretending.
const [, , name, milestone] = process.argv
console.error(`pnpm ${name} is not implemented yet (milestone ${milestone}). See docs/PROGRESS.md.`)
process.exit(1)
