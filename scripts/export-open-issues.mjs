import { initializeApp, deleteApp } from 'firebase/app'
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const firebaseConfig = {
  apiKey: 'AIzaSyDsJJBwUiwAi2WXzVjJaIYS0JceOrro274',
  authDomain: 'e9-fcdaf.firebaseapp.com',
  projectId: 'e9-fcdaf',
  storageBucket: 'e9-fcdaf.firebasestorage.app',
  messagingSenderId: '966233161319',
  appId: '1:966233161319:web:2c6eca55e7ad5f34b05ec2',
  measurementId: 'G-6Y66RYDL5F',
}

/** @returns {Promise<string|undefined>} */
async function passphraseFromEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  try {
    const raw = await readFile(envPath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const m = trimmed.match(/^SYNC_PASSPHRASE\s*=\s*(.*)$/)
      if (!m) continue
      let v = m[1].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      const out = v.trim()
      if (out) return out
    }
  } catch {
    // missing file is fine
  }
  return undefined
}

const outputArg = process.argv[2]
const outputPath = path.resolve(process.cwd(), outputArg || '.cursor/open-issues.json')

function hashPassphrase(raw) {
  return createHash('sha256').update(raw.trim().toLowerCase()).digest('hex')
}

async function main() {
  const passphrase =
    process.env.SYNC_PASSPHRASE?.trim() || (await passphraseFromEnvLocal())

  if (!passphrase) {
    console.error(
      'Missing sync passphrase. Set SYNC_PASSPHRASE in the environment, or add SYNC_PASSPHRASE=... to .env.local (see .env.example).',
    )
    process.exit(1)
  }

  const hash = hashPassphrase(passphrase)
  const app = initializeApp(firebaseConfig)
  try {
    const db = getFirestore(app)
    const vaultRef = doc(db, 'vaults', hash)
    const snap = await getDoc(vaultRef)

    const issues = snap.exists() && Array.isArray(snap.data().issues) ? snap.data().issues : []
    const open = issues
      .filter(issue => (issue.status || (issue.completed ? 'complete' : 'open')) === 'open')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(issue => ({
        id: issue.id,
        text: issue.text,
        createdAt: issue.createdAt || null,
        updatedAt: issue.updatedAt || null,
      }))

    // Move exported "open" issues into "checking" so the queue reflects in-progress work.
    if (open.length > 0) {
      const openIds = new Set(open.map(issue => issue.id))
      const nowIso = new Date().toISOString()
      const migrated = issues.map(issue => {
        const status = issue.status || (issue.completed ? 'complete' : 'open')
        if (status !== 'open' || !openIds.has(issue.id)) return issue
        return {
          ...issue,
          status: 'checking',
          completed: false,
          updatedAt: nowIso,
        }
      })
      await setDoc(vaultRef, { issues: migrated, updatedAt: Date.now() }, { merge: true })
    }

    const payload = {
      source: 'firestore-vault',
      exportedAt: new Date().toISOString(),
      totalOpen: open.length,
      openIssues: open,
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    console.log(`Exported ${open.length} open issue(s) to ${outputPath}`)
  } finally {
    await deleteApp(app)
  }
}

main().catch(err => {
  console.error('Failed to export open issues:', err?.message || err)
  process.exit(1)
})
