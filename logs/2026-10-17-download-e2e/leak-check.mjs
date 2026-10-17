// Lists every sandbox left in the Daytona org (walks the async iterator; PLAN.md notes `.items`
// was always 0 in SDK 0.220.0).
import { Daytona } from '@daytona/sdk'

await new Promise((r) => setTimeout(r, 3000)) // a deleted sandbox can be listed for a second or two
const left = []
for await (const s of new Daytona().list()) left.push(`${s.id} ${s.state} ${JSON.stringify(s.labels)}`)
console.log(`${new Date().toISOString()}  sandboxes left in the org: ${left.length}`)
for (const l of left) console.log(`  ${l}`)
