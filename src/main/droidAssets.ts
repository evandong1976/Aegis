// What every Droid analysis needs from the repo, bundled into the app at build time:
// - the file-type reference every Droid call carries (droidBrief.ts), from
//   resources/droid/file_types_vulnerabilities.md;
// - the inspector Droid's tools run in the sandbox, sandbox/aegis_inspect.py.
// Edit those files, not this one. The try scripts read the same files from disk.

import reference from '../../resources/droid/file_types_vulnerabilities.md?raw'
import inspector from '../../sandbox/aegis_inspect.py?raw'
import { parseReference, type ReferenceRow } from './fileTypes'

export const FILE_TYPE_REFERENCE: string = reference

/** The reference's table, parsed once. */
export const REFERENCE_ROWS: ReferenceRow[] = parseReference(reference)

export const INSPECTOR_SOURCE: Buffer = Buffer.from(inspector, 'utf8')
