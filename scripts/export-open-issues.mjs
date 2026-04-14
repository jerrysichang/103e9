import { initializeApp, deleteApp } from 'firebase/app'
import { getFirestore, doc, getDoc } from 'firebase/firestore'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
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

const passphrase = process.env.SYNC_PASSPHRASE?.trim()
if (!passphrase) {
  console.error('Missing SYNC_PASSPHRASE env var.')
  process.exit(1)
}

const outputArg = process.argv[2]
const outputPath = path.resolve(process.cwd(), outputArg || '.cursor/open-issues.json')

function hashPassphrase(raw) {
  return createHash('sha256').update(raw.trim().toLowerCase()).digest('hex')
}

async function main() {
  const hash = hashPassphrase(passphrase)
  const app = initializeApp(firebaseConfig)
  try {
    const db = getFirestore(app)
    const vaultRef = doc(db, 'vaults', hash)
    const snap = await getDoc(vaultRef)

    const issues = snap.exists() && Array.isArray(snap.data().issues) ? snap.data().issues : []
    const open = issues
      .filter(issue => !issue.completed)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(issue => ({
        id: issue.id,
        text: issue.text,
        createdAt: issue.createdAt || null,
        updatedAt: issue.updatedAt || null,
      }))

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
